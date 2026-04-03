import { WebSocketServer } from 'ws';
import { createDeepgramStream } from '../services/stt.js';
import { translateAndSpeak } from '../services/pipeline.js';
import {
  createSession, endSession, joinSessionDB, leaveSessionDB, syncListenerCount, validateToken,
} from '../services/supabase.js';

const activeSessions = new Map();
global.activeSessions = activeSessions;
const lingeringSessions = new Map();

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    let role = null, sessionId = null, userId = null;
    ws.on('message', async (data) => {
      try {
        const msg = tryParseJSON(data);
        if (msg) {
          if (msg.token && !userId) {
            try { const u = await validateToken(msg.token); if (u) userId = u.id; } catch (e) { console.warn('Token validation failed:', e.message); }
          }
          if (!userId && msg.professorId) userId = msg.professorId;
          if (!userId && msg.studentId) userId = msg.studentId;
          await handleControlMessage(ws, msg, userId, (r, s) => { role = r; sessionId = s; });
        } else if (role === 'professor' && sessionId) {
          handleAudioData(sessionId, data);
        }
      } catch (err) {
        console.error('WebSocket message error:', err.message);
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    });
    ws.on('error', (err) => console.error(`WebSocket error: role=${role}, sessionId=${sessionId}, error=${err.message}`));
    ws.on('close', async (code) => {
      console.log(`WebSocket closed: role=${role}, sessionId=${sessionId}, code=${code}`);
      try {
        if (role === 'professor' && sessionId) {
          await closeSession(sessionId);
        } else if (role === 'student' && sessionId) {
          const session = activeSessions.get(sessionId);
          if (session) {
            session.listeners.delete(ws);
            syncListenerCount(sessionId, session.listeners.size).catch(() => {});
            if (userId) await leaveSessionDB(sessionId, userId);
          }
        }
      } catch (err) { console.error('Close handler error:', err.message); }
    });
  });
  console.log('WebSocket server ready');
}

function openDeepgramStream(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) return;
  if (session.dgStream) { try { session.dgStream.close(); } catch (_) {} session.dgStream = null; }
  session.dgStream = createDeepgramStream(
    session.language,
    (transcript, isFinal) => onTranscript(sessionId, transcript, isFinal),
    (err) => {
      console.error(`[Session ${sessionId}] Deepgram stream error:`, err.message);
      setTimeout(() => { if (activeSessions.has(sessionId)) openDeepgramStream(sessionId); }, 500);
    }
  );
}

async function closeSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) return;
  // Registra lingering ANTES de fechar — session_ended so sera enviado apos o ultimo audio
  lingeringSessions.set(sessionId, { listeners: new Map(session.listeners), language: session.language });
  if (session.dgStream) { try { session.dgStream.close(); } catch (_) {} }
  activeSessions.delete(sessionId);
  syncListenerCount(sessionId, 0).catch(() => {});
  await endSession(sessionId);
  console.log(`[Session ${sessionId}] encerrada`);
  // Fallback: se Deepgram nao emitir is_final em 4s, notifica e limpa
  setTimeout(() => {
    if (lingeringSessions.has(sessionId)) {
      notifySessionEnded(sessionId);
      lingeringSessions.delete(sessionId);
    }
  }, 4000);
}

function notifySessionEnded(sessionId) {
  const lingering = lingeringSessions.get(sessionId);
  if (!lingering) return;
  for (const [lws] of lingering.listeners) {
    try { lws.send(JSON.stringify({ type: 'session_ended' })); } catch (_) {}
  }
}

async function onTranscript(sessionId, transcript, isFinal) {
  const session = activeSessions.get(sessionId);
  const lingering = lingeringSessions.get(sessionId);
  const listeners = session?.listeners || lingering?.listeners;
  const language = session?.language || lingering?.language;
  if (!listeners || listeners.size === 0) return;
  if (!isFinal) {
    if (session?.professorWs?.readyState === 1) session.professorWs.send(JSON.stringify({ type: 'transcript_interim', text: transcript }));
    return;
  }
  console.log(`[Session ${sessionId}] Transcript final: "${transcript}"`);
  if (session?.professorWs?.readyState === 1) session.professorWs.send(JSON.stringify({ type: 'transcript_final', text: transcript }));
  if (session?._processing) { session._queue.push(transcript); return; }
  if (session) session._processing = true;
  await processTranscript(transcript, listeners, language);
  if (session) session._processing = false;
  while (session?._queue?.length > 0) {
    const next = session._queue.shift();
    session._processing = true;
    await processTranscript(next, listeners, language);
    session._processing = false;
  }
  // Se era lingering, notifica session_ended APOS entregar o audio
  if (!session && lingeringSessions.has(sessionId)) {
    notifySessionEnded(sessionId);
    lingeringSessions.delete(sessionId);
  }
}

async function processTranscript(transcript, listeners, language) {
  const neededLangs = new Set();
  for (const [, info] of listeners) { const lang = info.targetLang || 'en'; if (lang !== language) neededLangs.add(lang); }
  if (neededLangs.size === 0) return;
  const audioByLang = new Map();
  await Promise.all([...neededLangs].map(async (targetLang) => {
    try { const audio = await translateAndSpeak(transcript, language, targetLang); if (audio) audioByLang.set(targetLang, audio); }
    catch (err) { console.error(`[Pipeline] Erro para ${targetLang}:`, err.message); }
  }));
  for (const [lws, info] of listeners) {
    const lang = info.targetLang || 'en';
    if (lang === language) continue;
    const audio = audioByLang.get(lang);
    if (audio && lws.readyState === 1) lws.send(JSON.stringify({ type: 'audio', data: Buffer.from(audio).toString('base64') }));
  }
}

function handleAudioData(sessionId, audioBuffer) {
  const session = activeSessions.get(sessionId);
  if (!session || session.listeners.size === 0) return;
  if (audioBuffer.length < 500) return;
  if (!session.dgStream || session.dgStream.readyState > 1) openDeepgramStream(sessionId);
  session.dgStream?.send(audioBuffer);
}

async function handleControlMessage(ws, msg, userId, setRole) {
  switch (msg.type) {
    case 'professor_start': {
      const professorId = userId || msg.professorId;
      if (!professorId) { ws.send(JSON.stringify({ type: 'error', message: 'Autenticacao necessaria' })); return; }
      try {
        const dbSession = await createSession(professorId, msg.subject || 'Aula', msg.language || 'pt');
        const sessionId = dbSession.id;
        activeSessions.set(sessionId, { professorWs: ws, professorId, professorName: msg.professorName || 'Professor', subject: dbSession.subject, language: dbSession.language, listeners: new Map(), dgStream: null, _processing: false, _queue: [] });
        openDeepgramStream(sessionId);
        setRole('professor', sessionId);
        ws.send(JSON.stringify({ type: 'session_created', sessionId }));
        console.log(`[Session ${sessionId}] criada por ${msg.professorName}`);
      } catch (err) { console.error('professor_start error:', err.message); ws.send(JSON.stringify({ type: 'error', message: err.message })); }
      break;
    }
    case 'professor_stop': {
      const sid = msg.sessionId;
      if (sid && activeSessions.has(sid)) { await closeSession(sid); ws.send(JSON.stringify({ type: 'session_stopped' })); }
      break;
    }
    case 'student_join': {
      const session = activeSessions.get(msg.sessionId);
      if (!session) { ws.send(JSON.stringify({ type: 'error', message: 'Sessao nao encontrada' })); return; }
      const studentId = userId || msg.studentId;
      const targetLang = msg.language || 'en';
      if (studentId) {
        for (const [ews, info] of session.listeners) { if (info.studentId === studentId && ews !== ws) { session.listeners.delete(ews); break; } }
      }
      session.listeners.set(ws, { studentId, targetLang });
      setRole('student', msg.sessionId);
      ws.send(JSON.stringify({ type: 'joined', professorName: session.professorName, subject: session.subject }));
      syncListenerCount(msg.sessionId, session.listeners.size).catch(() => {});
      if (studentId) joinSessionDB(msg.sessionId, studentId, targetLang).catch((err) => console.error('joinSessionDB error (non-fatal):', err.message));
      break;
    }
    case 'student_set_language': {
      const lang = msg.language || 'en';
      for (const [, session] of activeSessions) { const info = session.listeners.get(ws); if (info) { info.targetLang = lang; break; } }
      ws.send(JSON.stringify({ type: 'language_set', language: lang }));
      break;
    }
    case 'ping': ws.send(JSON.stringify({ type: 'pong' })); break;
  }
}

function tryParseJSON(data) {
  if (typeof data === 'string' || (Buffer.isBuffer(data) && data[0] === 0x7b)) {
    try { return JSON.parse(data.toString()); } catch { return null; }
  }
  return null;
}