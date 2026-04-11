import { WebSocketServer } from "ws";
import { createRealtimeTranslator } from "../services/realtime-translator.js";
import { createSession, endSession, joinSessionDB, leaveSessionDB, syncListenerCount, validateToken } from "../services/supabase.js";

const activeSessions = new Map();
global.activeSessions = activeSessions;
const lingeringSessions = new Map();

function isFatalInworldError(message = "") {
  const normalized = String(message).toLowerCase();
  return (
    normalized.includes("401") ||
    normalized.includes("402") ||
    normalized.includes("403") ||
    normalized.includes("auth") ||
    normalized.includes("quota") ||
    normalized.includes("payment") ||
    normalized.includes("billing")
  );
}

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws, req) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`[WS] Nova conexão de ${clientIp}`);
    let role = null, sessionId = null, userId = null;

    ws.on("message", async (data) => {
      try {
        const msg = tryParseJSON(data);
        if (msg) {
          if (msg.token && !userId) {
            try { const u = await validateToken(msg.token); if (u) userId = u.id; } catch (e) { console.warn("Token validation failed:", e.message); }
          }
          if (!userId && msg.professorId) userId = msg.professorId;
          if (!userId && msg.studentId) userId = msg.studentId;

          if (msg.type === "audio_chunk" && role === "professor" && sessionId) {
            handleAudioData(sessionId, Buffer.from(msg.data, "base64"));
            return;
          }
          await handleControlMessage(ws, msg, userId, (r, s) => { role = r; sessionId = s; });
        } else if (role === "professor" && sessionId) {
          handleAudioData(sessionId, data);
        }
      } catch (err) {
        console.error("WebSocket message error:", err.message);
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
    });

    ws.on("error", (err) => console.error(`WebSocket error: role=${role}, sessionId=${sessionId}, error=${err.message}`));

    ws.on("close", async (code) => {
      console.log(`WebSocket closed: role=${role}, sessionId=${sessionId}, code=${code}`);
      try {
        if (role === "professor" && sessionId) {
          await closeSession(sessionId);
        } else if (role === "student" && sessionId) {
          const s = activeSessions.get(sessionId);
          if (s) {
            s.listeners.delete(ws);
            syncListenerCount(sessionId, s.listeners.size).catch(() => {});
            if (userId) await leaveSessionDB(sessionId, userId);
          }
        }
      } catch (err) { console.error("Close handler error:", err.message); }
    });
  });
  console.log("WebSocket server ready");
}

function openRealtimeStream(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session || session.rtBlocked) return;

  if (session.rtStream) {
    try { session.rtStream.close(); } catch (_) {}
    session.rtStream = null;
  }

  session.rtStream = createRealtimeTranslator(
    {
      initialTargetLang: session.currentTargetLang || "en",
      onAudioDelta: (audioChunk) => onOutputAudio(sessionId, audioChunk),
      onTranscriptDelta: (deltaText) => onOutputTranscript(sessionId, deltaText),
      onConnected: () => console.log(`[Session ${sessionId}] Inworld Realtime conectado`),
      onDebug: (msg) => console.log(msg),
      onError: (err) => {
        console.error(`[Session ${sessionId}] Inworld error:`, err.message);
        const stream = session.rtStream;
        session.rtStream = null;
        if (isFatalInworldError(err.message)) {
          try { stream?.close?.(); } catch (_) {}
          session.rtBlocked = true;
          console.warn(`[Session ${sessionId}] Realtime bloqueado por erro fatal: ${err.message}`);
          return;
        }
        setTimeout(() => {
          if (activeSessions.has(sessionId)) openRealtimeStream(sessionId);
        }, 1000);
      },
    }
  );
}

function onOutputTranscript(sessionId, transcriptDelta) {
  const session = activeSessions.get(sessionId);
  if (!session || !transcriptDelta) return;
  if (session.professorWs?.readyState === 1) {
    session.professorWs.send(JSON.stringify({
      type: "translated_transcript_delta",
      text: transcriptDelta,
    }));
  }
}

function onOutputAudio(sessionId, audioChunk) {
  const session = activeSessions.get(sessionId);
  const lingering = lingeringSessions.get(sessionId);
  const listeners = session?.listeners || lingering?.listeners;
  if (!listeners || listeners.size === 0) return;

  const data = Buffer.from(audioChunk).toString("base64");
  for (const [lws, info] of listeners) {
    const lang = info.targetLang || "en";
    if (lang === (session?.language || lingering?.language)) continue;
    if (lws.readyState !== 1) continue;
    lws.send(JSON.stringify({
      type: "audio_chunk",
      data,
      codec: "pcm16le",
      sampleRate: 24000,
      channels: 1,
      source: "inworld-realtime",
    }));
  }
}

async function closeSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) return;
  lingeringSessions.set(sessionId, { listeners: new Map(session.listeners), language: session.language });
  if (session.rtStream) { try { session.rtStream.close(); } catch (_) {} }
  activeSessions.delete(sessionId);
  syncListenerCount(sessionId, 0).catch(() => {});
  await endSession(sessionId);
  console.log(`[Session ${sessionId}] encerrada`);
  setTimeout(() => {
    if (lingeringSessions.has(sessionId)) { notifySessionEnded(sessionId); lingeringSessions.delete(sessionId); }
  }, 4000);
}

function notifySessionEnded(sessionId) {
  const l = lingeringSessions.get(sessionId);
  if (!l) return;
  for (const [lws] of l.listeners) { try { lws.send(JSON.stringify({ type: "session_ended" })); } catch (_) {} }
}

function handleAudioData(sessionId, audioBuffer) {
  const session = activeSessions.get(sessionId);
  if (!session || audioBuffer.length < 100 || session.rtBlocked) return;

  if (!session.rtStream || session.rtStream.isClosed || session.rtStream.readyState > 1) {
    openRealtimeStream(sessionId);
  }

  session.rtStream?.appendAudioChunk(audioBuffer);
}

async function handleControlMessage(ws, msg, userId, setRole) {
  switch (msg.type) {
    case "professor_start": {
      const professorId = userId || msg.professorId;
      if (!professorId) { ws.send(JSON.stringify({ type: "error", message: "Autenticacao necessaria" })); return; }
      try {
        const dbSession = await createSession(professorId, msg.subject || "Aula", msg.language || "pt");
        const sessionId = dbSession.id;
        activeSessions.set(sessionId, {
          professorWs: ws,
          professorId,
          professorName: msg.professorName || "Professor",
          subject: dbSession.subject,
          language: dbSession.language,
          listeners: new Map(),
          currentTargetLang: "en",
          rtStream: null,
          rtBlocked: false,
        });
        openRealtimeStream(sessionId);
        setRole("professor", sessionId);
        ws.send(JSON.stringify({ type: "session_created", sessionId }));
        console.log(`[Session ${sessionId}] criada por ${msg.professorName}`);
      } catch (err) {
        console.error("professor_start error:", err.message);
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
      break;
    }
    case "professor_stop": {
      const sid = msg.sessionId;
      if (sid && activeSessions.has(sid)) { await closeSession(sid); ws.send(JSON.stringify({ type: "session_stopped" })); }
      break;
    }
    case "student_join": {
      console.log(`[WS] student_join recebido: sessionId=${msg.sessionId}, lang=${msg.language}, studentId=${userId || msg.studentId}`);
      const session = activeSessions.get(msg.sessionId);
      if (!session) {
        console.warn(`[WS] Sessao ${msg.sessionId} nao encontrada em activeSessions (total: ${activeSessions.size})`);
        ws.send(JSON.stringify({ type: "error", message: "Sessao nao encontrada" }));
        return;
      }
      const studentId = userId || msg.studentId;
      const targetLang = msg.language || "en";
      if (studentId) {
        for (const [ews, info] of session.listeners) {
          if (info.studentId === studentId && ews !== ws) { session.listeners.delete(ews); break; }
        }
      }
      session.listeners.set(ws, { studentId, targetLang });
      session.currentTargetLang = targetLang;
      session.rtStream?.updateTargetLanguage(targetLang, { forceReconnect: true });
      setRole("student", msg.sessionId);
      ws.send(JSON.stringify({ type: "joined", professorName: session.professorName, subject: session.subject }));
      console.log(`[Session ${msg.sessionId}] Aluno conectado (total: ${session.listeners.size})`);
      syncListenerCount(msg.sessionId, session.listeners.size).catch(() => {});
      if (studentId) joinSessionDB(msg.sessionId, studentId, targetLang).catch((e) => console.error("joinSessionDB:", e.message));
      break;
    }
    case "student_set_language": {
      const lang = msg.language || "en";
      for (const [, session] of activeSessions) {
        const info = session.listeners.get(ws);
        if (info) {
          info.targetLang = lang;
          session.currentTargetLang = lang;
          session.rtStream?.updateTargetLanguage(lang, { forceReconnect: true });
          break;
        }
      }
      ws.send(JSON.stringify({ type: "language_set", language: lang }));
      break;
    }
    case "ping": ws.send(JSON.stringify({ type: "pong" })); break;
  }
}

function tryParseJSON(data) {
  if (typeof data === "string" || (Buffer.isBuffer(data) && data[0] === 0x7b)) {
    try { return JSON.parse(data.toString()); } catch { return null; }
  }
  return null;
}
