import { WebSocketServer } from "ws";
import { createSession, endSession, joinSessionDB, leaveSessionDB, syncListenerCount, validateToken } from "../services/supabase.js";

const activeSessions = new Map();
global.activeSessions = activeSessions;


export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  // Server-initiated ping every 25s to keep connections alive through proxies/LBs
  const aliveInterval = setInterval(() => {
    for (const client of wss.clients) {
      if (client._isAlive === false) { client.terminate(); continue; }
      client._isAlive = false;
      client.ping();
    }
  }, 25000);
  wss.on("close", () => clearInterval(aliveInterval));

  wss.on("connection", (ws, req) => {
    ws._isAlive = true;
    ws.on("pong", () => { ws._isAlive = true; });

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
            broadcastAudio(sessionId, msg.data);
            return;
          }
          await handleControlMessage(ws, msg, userId, (r, s) => { role = r; sessionId = s; });
        } else if (role === "professor" && sessionId) {
          broadcastAudio(sessionId, Buffer.from(data).toString("base64"));
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

/**
 * Broadcasts raw PCM audio (base64) from the professor to all student listeners.
 * Each student's browser handles its own Inworld WebRTC translation.
 */
function broadcastAudio(sessionId, base64Data) {
  const session = activeSessions.get(sessionId);
  if (!session || !base64Data || session.listeners.size === 0) return;

  const payload = JSON.stringify({
    type: "audio_chunk",
    data: base64Data,
    codec: "pcm16le",
    sampleRate: 24000,
    channels: 1,
  });

  for (const [lws] of session.listeners) {
    if (lws.readyState !== 1) continue;
    lws.send(payload);
  }
}

async function closeSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  // Notify students immediately so the player closes right away
  const endPayload = JSON.stringify({ type: "session_ended" });
  for (const [lws] of session.listeners) {
    try { if (lws.readyState === 1) lws.send(endPayload); } catch (_) {}
  }

  activeSessions.delete(sessionId);
  syncListenerCount(sessionId, 0).catch(() => {});
  await endSession(sessionId);
  console.log(`[Session ${sessionId}] encerrada`);
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
        });
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
