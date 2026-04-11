import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { setupWebSocket } from './websocket/handler.js';
import { createRealtimeTranslatorWebRTC } from './services/realtime-translator.js';

const app = express();
const server = createServer(app);
const realtimeWebRTC = createRealtimeTranslatorWebRTC();

app.use(express.json());

// CORS
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/realtime/ice-servers', async (_req, res) => {
  try {
    const iceServers = await realtimeWebRTC.getIceServers();
    res.json({ ice_servers: iceServers });
  } catch (err) {
    console.error('Erro ao buscar ICE servers:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/realtime/calls', async (req, res) => {
  const { sdp, targetLang, voice, speed, instructions, session } = req.body || {};
  try {
    if (!sdp || typeof sdp !== 'string') {
      return res.status(400).json({ error: 'Campo sdp obrigatorio' });
    }

    const call = await realtimeWebRTC.createOffer({
      sdp,
      targetLang,
      voice,
      speed,
      instructions,
      session,
    });

    return res.json({
      id: call.callId,
      sdp: call.sdp,
      ice_servers: call.iceServers || [],
    });
  } catch (err) {
    console.error('Erro ao criar call WebRTC:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/realtime/calls/:callId/answer', (req, res) => {
  const { sdp } = req.body || {};
  try {
    if (!sdp || typeof sdp !== 'string') {
      return res.status(400).json({ error: 'Campo sdp obrigatorio' });
    }
    realtimeWebRTC.setAnswer(sdp);
    return res.json({ ok: true, callId: req.params.callId });
  } catch (err) {
    console.error('Erro ao salvar SDP answer:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/realtime/calls/:callId/events', async (req, res) => {
  const event = req.body;
  try {
    const payload = await realtimeWebRTC.sendEvent(event, { callId: req.params.callId });
    return res.json({ ok: true, payload });
  } catch (err) {
    console.error('Erro ao encaminhar evento WebRTC:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// API para listar sessões ativas (busca do Supabase)
app.get('/api/sessions', async (_req, res) => {
  try {
    const { getLiveSessions } = await import('./services/supabase.js');
    const sessions = await getLiveSessions();
    const list = sessions.map((s) => ({
      id: s.id,
      professorName: s.professors?.name || 'Professor',
      subject: s.subject,
      language: s.language,
      listeners: s.listener_count,
      startedAt: s.started_at,
      department: s.professors?.department,
    }));
    res.json(list);
  } catch (err) {
    console.error('Erro ao buscar sessões:', err.message);
    // Fallback: sessões em memória
    const memSessions = global.activeSessions || new Map();
    const list = [];
    for (const [id, session] of memSessions) {
      list.push({
        id,
        professorName: session.professorName,
        subject: session.subject,
        language: session.language,
        listeners: session.listeners.size,
        startedAt: session.startedAt,
      });
    }
    res.json(list);
  }
});

setupWebSocket(server);

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`UEL Connect backend running on port ${PORT}`);
  try {
    const { cleanupStaleSessions } = await import('./services/supabase.js');
    await cleanupStaleSessions();
  } catch (err) {
    console.warn('Cleanup de sessões falhou:', err.message);
  }
});
