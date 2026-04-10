import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { setupWebSocket } from './websocket/handler.js';

const app = express();
const server = createServer(app);

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
