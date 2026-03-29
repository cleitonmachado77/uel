import { WebSocketServer } from 'ws';
import { processAudioPipeline } from '../services/pipeline.js';
import {
  createSession,
  endSession,
  joinSessionDB,
  leaveSessionDB,
  syncListenerCount,
  validateToken,
} from '../services/supabase.js';

// Sessões ativas em memória (para streaming de áudio em tempo real)
// Map<sessionId, { professorWs, professorId, professorName, subject, language, listeners: Map<ws, { studentId, targetLang }> }>
const activeSessions = new Map();
global.activeSessions = activeSessions;

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    let role = null;
    let sessionId = null;
    let userId = null;

    ws.on('message', async (data) => {
      try {
        const msg = tryParseJSON(data);

        if (msg) {
          // Tenta autenticar via token, mas não bloqueia se falhar
          if (msg.token && !userId) {
            try {
              const user = await validateToken(msg.token);
              if (user) userId = user.id;
            } catch (e) {
              console.warn('Token validation failed:', e.message);
            }
          }
          // Fallback: usa professorId/studentId da mensagem
          if (!userId && msg.professorId) userId = msg.professorId;
          if (!userId && msg.studentId) userId = msg.studentId;

          await handleControlMessage(ws, msg, userId, (r, s) => {
            role = r;
            sessionId = s;
          });
        } else if (role === 'professor' && sessionId) {
          await handleAudioData(sessionId, data);
        }
      } catch (err) {
        console.error('WebSocket message error:', err.message);
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    });

    ws.on('error', (err) => {
      console.error(`WebSocket error: role=${role}, sessionId=${sessionId}, error=${err.message}`);
    });

    ws.on('close', async (code, reason) => {
      console.log(`WebSocket closed: role=${role}, sessionId=${sessionId}, code=${code}, reason=${reason?.toString()}`);
      try {
        if (role === 'professor' && sessionId) {
          const session = activeSessions.get(sessionId);
          if (session) {
            for (const [listener] of session.listeners) {
              listener.send(JSON.stringify({ type: 'session_ended' }));
            }
            activeSessions.delete(sessionId);
            // Zera contador e encerra sessão
            syncListenerCount(sessionId, 0).catch(() => {});
            await endSession(sessionId);
            console.log(`Session ${sessionId} ended`);
          }
        } else if (role === 'student' && sessionId) {
          const session = activeSessions.get(sessionId);
          if (session) {
            session.listeners.delete(ws);
            // Sincroniza contador com o número real de listeners
            syncListenerCount(sessionId, session.listeners.size).catch(() => {});
            if (userId) await leaveSessionDB(sessionId, userId);
          }
        }
      } catch (err) {
        console.error('Close handler error:', err.message);
      }
    });
  });

  console.log('WebSocket server ready');
}

async function handleControlMessage(ws, msg, userId, setRole) {
  switch (msg.type) {
    case 'professor_start': {
      const professorId = userId || msg.professorId;
      if (!professorId) {
        ws.send(JSON.stringify({ type: 'error', message: 'Autenticação necessária' }));
        return;
      }

      try {
        // Persiste no Supabase
        const dbSession = await createSession(
          professorId,
          msg.subject || 'Aula',
          msg.language || 'pt'
        );

        const sessionId = dbSession.id;
        activeSessions.set(sessionId, {
          professorWs: ws,
          professorId,
          professorName: msg.professorName || 'Professor',
          subject: dbSession.subject,
          language: dbSession.language,
          listeners: new Map(),
        });

        setRole('professor', sessionId);
        ws.send(JSON.stringify({ type: 'session_created', sessionId }));
        console.log(`Session ${sessionId} created by ${msg.professorName}`);
      } catch (err) {
        console.error('professor_start error:', err.message);
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
      break;
    }

    case 'professor_stop': {
      const sid = msg.sessionId;
      if (sid && activeSessions.has(sid)) {
        const session = activeSessions.get(sid);
        for (const [listener] of session.listeners) {
          listener.send(JSON.stringify({ type: 'session_ended' }));
        }
        activeSessions.delete(sid);
        await endSession(sid);
        ws.send(JSON.stringify({ type: 'session_stopped' }));
      }
      break;
    }

    case 'student_join': {
      const session = activeSessions.get(msg.sessionId);
      if (!session) {
        ws.send(JSON.stringify({ type: 'error', message: 'Sessão não encontrada' }));
        return;
      }

      const studentId = userId || msg.studentId;
      const targetLang = msg.language || 'en';

      session.listeners.set(ws, { studentId, targetLang });
      setRole('student', msg.sessionId);

      ws.send(JSON.stringify({
        type: 'joined',
        professorName: session.professorName,
        subject: session.subject,
      }));

      // Sincroniza contador com o número real de listeners
      syncListenerCount(msg.sessionId, session.listeners.size).catch(() => {});

      // Persiste participação em background
      if (studentId) {
        joinSessionDB(msg.sessionId, studentId, targetLang).catch((err) => {
          console.error('joinSessionDB error (non-fatal):', err.message);
        });
      }
      break;
    }

    case 'student_set_language': {
      const lang = msg.language || 'en';
      if (msg.sessionId || true) {
        for (const [, session] of activeSessions) {
          const info = session.listeners.get(ws);
          if (info) {
            info.targetLang = lang;
            break;
          }
        }
      }
      ws.send(JSON.stringify({ type: 'language_set', language: lang }));
      break;
    }

    case 'ping': {
      ws.send(JSON.stringify({ type: 'pong' }));
      break;
    }
  }
}

async function handleAudioData(sessionId, audioBuffer) {
  const session = activeSessions.get(sessionId);
  if (!session || session.listeners.size === 0) return;

  // Cada chunk já é um WebM completo de ~3s (gerado pelo frontend)
  if (audioBuffer.length < 2000) return;

  // Agrupa listeners por idioma alvo
  const byLanguage = new Map();
  for (const [ws, info] of session.listeners) {
    const lang = info.targetLang || 'en';
    if (!byLanguage.has(lang)) byLanguage.set(lang, []);
    byLanguage.get(lang).push(ws);
  }

  for (const [targetLang, listeners] of byLanguage) {
    try {
      const translatedAudio = await processAudioPipeline(
        audioBuffer,
        session.language,
        targetLang
      );

      if (translatedAudio) {
        // Envia como JSON com base64 para máxima compatibilidade com proxies/mobile
        const audioBase64 = Buffer.from(translatedAudio).toString('base64');
        const audioMsg = JSON.stringify({ type: 'audio', data: audioBase64 });
        for (const listener of listeners) {
          if (listener.readyState === 1) {
            listener.send(audioMsg);
          }
        }
      }
    } catch (err) {
      console.error(`Pipeline error for ${targetLang}:`, err.message);
    }
  }
}

function tryParseJSON(data) {
  if (typeof data === 'string' || (Buffer.isBuffer(data) && data[0] === 0x7b)) {
    try {
      return JSON.parse(data.toString());
    } catch {
      return null;
    }
  }
  return null;
}
