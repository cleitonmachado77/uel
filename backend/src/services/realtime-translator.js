import { WebSocket } from 'ws';

const INWORLD_API_KEY = process.env.INWORLD_API_KEY;
const INWORLD_REALTIME_URL = 'wss://api.inworld.ai/api/v1/realtime/session';
const INWORLD_WEBRTC_API_BASE_URL = 'https://api.inworld.ai';

const DEFAULT_TARGET_LANG = 'en';

const TARGET_LANGUAGE_MAP = {
  en: 'inglês (US)',
  es: 'espanhol (ES)',
  fr: 'francês (FR)',
  de: 'alemão (DE)',
  it: 'italiano (IT)',
  ja: 'japonês (JA)',
  ko: 'coreano (KO)',
  zh: 'chinês mandarim (ZH)',
  pt: 'português (Brasil)',
};

function buildTranslatorInstructions(targetLang) {
  const humanTarget = TARGET_LANGUAGE_MAP[targetLang] || TARGET_LANGUAGE_MAP[DEFAULT_TARGET_LANG];
  const strictTargetRule = targetLang === 'fr'
    ? 'Responda SOMENTE em francês (França). Nunca use inglês.'
    : `Responda SOMENTE em ${humanTarget}. Nunca use inglês, exceto se o idioma alvo for inglês.`;
  return `Você é um tradutor simultâneo profissional. O usuário fala em português (Brasil). Traduza imediatamente tudo que ele disser para ${humanTarget}, falando de forma natural, fluida e mantendo o tom emocional original. Seja conciso e natural. Nunca adicione explicações. Responda sempre em voz falada. Nunca diga a palavra "Voice" ou "voz". ${strictTargetRule}`;
}

function buildSessionUpdate({ instructions, voice, speed }) {
  return {
    type: 'session.update',
    session: {
      instructions,
      audio: {
        input: {
          transcription: {
            model: 'assemblyai/universal-streaming-multilingual',
          },
          turn_detection: {
            type: 'semantic_vad',
            eagerness: 'medium',
            create_response: true,
            interrupt_response: true,
          },
        },
        output: {
          voice,
          speed,
        },
      },
      output_modalities: ['text', 'audio'],
    },
  };
}

export function createRealtimeTranslator(options = {}) {
  if (!INWORLD_API_KEY) {
    throw new Error('INWORLD_API_KEY nao definida');
  }

  const {
    instructions: customInstructions,
    initialTargetLang = DEFAULT_TARGET_LANG,
    voice = 'Dennis',
    speed = 1.0,
    maxReconnectAttempts = 6,
    onAudioDelta,
    onTranscriptDelta,
    onConnected,
    onError,
    onDebug,
  } = options;

  let ws = null;
  let isClosed = false;
  let isSessionReady = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let audioQueue = [];
  let targetLang = initialTargetLang;

  const debug = (message) => onDebug?.(`[InworldRT] ${message}`);

  const flushAudioQueue = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !isSessionReady) return;
    if (audioQueue.length === 0) return;
    for (const chunk of audioQueue) {
      ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: chunk }));
    }
    audioQueue = [];
  };

  const sendSessionUpdate = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const dynamicInstructions = customInstructions || buildTranslatorInstructions(targetLang);
    ws.send(JSON.stringify(buildSessionUpdate({ instructions: dynamicInstructions, voice, speed })));
    debug(`session.update enviado target=${targetLang} voice=${voice}`);
  };

  const connect = () => {
    if (isClosed) return;

    const key = `voice-${Date.now()}`;
    const url = `${INWORLD_REALTIME_URL}?key=${encodeURIComponent(key)}&protocol=realtime`;
    ws = new WebSocket(url, {
      headers: { Authorization: `Basic ${INWORLD_API_KEY}` },
    });

    ws.on('open', () => {
      debug('WebSocket conectado');
    });

    ws.on('message', (rawData) => {
      let msg = null;
      try {
        msg = JSON.parse(rawData.toString());
      } catch (err) {
        onError?.(new Error(`Mensagem invalida do Inworld: ${err.message}`));
        return;
      }

      if (msg.type === 'session.created') {
        sendSessionUpdate();
        return;
      }

      if (msg.type === 'session.updated') {
        isSessionReady = true;
        reconnectAttempts = 0;
        onConnected?.();
        flushAudioQueue();
        return;
      }

      if (msg.type === 'response.output_audio.delta' && msg.delta) {
        onAudioDelta?.(Buffer.from(msg.delta, 'base64'));
        return;
      }

      if (msg.type === 'response.output_audio_transcript.delta' && msg.delta) {
        onTranscriptDelta?.(msg.delta);
        return;
      }

      if (msg.type === 'error') {
        const errorText = msg.error?.message || msg.message || 'Erro desconhecido';
        onError?.(new Error(`Inworld error: ${errorText}`));
      }
    });

    ws.on('error', (err) => {
      onError?.(err);
    });

    ws.on('close', (code, reason) => {
      isSessionReady = false;
      if (isClosed) return;

      debug(`WebSocket fechado code=${code} reason=${reason?.toString() || ''}`);
      if (reconnectAttempts >= maxReconnectAttempts) {
        onError?.(new Error('Limite de reconexao do Inworld atingido'));
        return;
      }

      reconnectAttempts += 1;
      const delayMs = Math.min(1000 * (2 ** (reconnectAttempts - 1)), 8000);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delayMs);
    });
  };

  const reconnectNow = () => {
    if (isClosed) return;
    try {
      ws?.removeAllListeners?.();
      ws?.close();
    } catch (_) {}
    isSessionReady = false;
    connect();
  };

  connect();

  return {
    appendAudioChunk(audioBuffer) {
      if (isClosed) return;
      const b64 = Buffer.from(audioBuffer).toString('base64');

      if (ws?.readyState === WebSocket.OPEN && isSessionReady) {
        ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 }));
        return;
      }

      audioQueue.push(b64);
      if (audioQueue.length > 200) {
        audioQueue.splice(0, audioQueue.length - 200);
      }
    },

    updateTargetLanguage(nextTargetLang, opts = {}) {
      if (!nextTargetLang || targetLang === nextTargetLang) return;
      targetLang = nextTargetLang;
      const forceReconnect = opts.forceReconnect !== false;
      if (forceReconnect) {
        debug(`troca de idioma detectada, recriando sessao target=${targetLang}`);
        reconnectNow();
        return;
      }
      if (ws?.readyState === WebSocket.OPEN && isSessionReady) {
        sendSessionUpdate();
      }
    },

    close() {
      isClosed = true;
      isSessionReady = false;
      audioQueue = [];
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      try {
        ws?.close();
      } catch (_) {}
    },

    get readyState() {
      return ws?.readyState;
    },

    get isClosed() {
      return isClosed;
    },
  };
}

function buildRealtimeSessionConfig({ instructions, voice, speed }) {
  return {
    type: 'realtime',
    instructions,
    output_modalities: ['text', 'audio'],
    audio: {
      input: {
        transcription: {
          model: 'assemblyai/universal-streaming-multilingual',
        },
        turn_detection: {
          type: 'semantic_vad',
          eagerness: 'medium',
          create_response: true,
          interrupt_response: true,
        },
      },
      output: {
        voice,
        speed,
      },
    },
  };
}

async function requestInworldWebRTC(path, { method = 'GET', body } = {}) {
  if (!INWORLD_API_KEY) {
    throw new Error('INWORLD_API_KEY nao definida');
  }

  const response = await fetch(`${INWORLD_WEBRTC_API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${INWORLD_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const responseText = await response.text();
  let payload = null;
  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch (_) {
    payload = responseText || null;
  }

  if (!response.ok) {
    const details = payload?.error?.message || payload?.message || responseText || response.statusText;
    throw new Error(`Inworld WebRTC ${method} ${path} falhou (${response.status}): ${details}`);
  }

  return payload;
}

export function createRealtimeTranslatorWebRTC(options = {}) {
  const {
    initialTargetLang = DEFAULT_TARGET_LANG,
    voice = 'Dennis',
    speed = 1.0,
    instructions: customInstructions,
    onDebug,
    onError,
    onRemoteAudioTrack,
  } = options;

  const state = {
    currentTargetLang: initialTargetLang,
    callId: null,
    answerSdp: null,
    isClosed: false,
  };

  const debug = (message) => onDebug?.(`[InworldWebRTC] ${message}`);

  return {
    async getIceServers() {
      try {
        const data = await requestInworldWebRTC('/v1/realtime/ice-servers');
        return data?.ice_servers || [];
      } catch (err) {
        onError?.(err);
        throw err;
      }
    },

    async createOffer({ sdp, targetLang, instructions, session, voice: nextVoice, speed: nextSpeed } = {}) {
      if (state.isClosed) throw new Error('Translator WebRTC fechado');
      if (!sdp) throw new Error('SDP offer obrigatoria');

      const nextTarget = targetLang || state.currentTargetLang;
      state.currentTargetLang = nextTarget;

      const nextInstructions =
        instructions ||
        customInstructions ||
        buildTranslatorInstructions(nextTarget);

      const payload = await requestInworldWebRTC('/v1/realtime/calls', {
        method: 'POST',
        body: {
          sdp,
          session: session || buildRealtimeSessionConfig({
            instructions: nextInstructions,
            voice: nextVoice || voice,
            speed: nextSpeed || speed,
          }),
        },
      });

      state.callId = payload?.id || null;
      state.answerSdp = payload?.sdp || null;

      debug(`call criada id=${state.callId || 'n/a'} target=${nextTarget}`);

      return {
        callId: state.callId,
        sdp: state.answerSdp,
        iceServers: payload?.ice_servers || [],
      };
    },

    setAnswer(sdp) {
      if (state.isClosed) throw new Error('Translator WebRTC fechado');
      if (!sdp) throw new Error('SDP answer obrigatoria');
      state.answerSdp = sdp;
      debug('SDP answer atualizada manualmente');
      return { ok: true };
    },

    async sendEvent(event, opts = {}) {
      if (state.isClosed) throw new Error('Translator WebRTC fechado');
      const callId = opts.callId || state.callId;
      if (!callId) throw new Error('callId nao definido para enviar evento');
      if (!event || typeof event !== 'object') throw new Error('Evento invalido para data channel');

      try {
        const payload = await requestInworldWebRTC(`/v1/realtime/calls/${callId}/events`, {
          method: 'POST',
          body: event,
        });

        if (event.type === 'remote_audio.track' && typeof onRemoteAudioTrack === 'function') {
          onRemoteAudioTrack(payload);
        }

        return payload;
      } catch (err) {
        onError?.(err);
        throw err;
      }
    },

    updateTargetLanguage(nextTargetLang) {
      if (!nextTargetLang || nextTargetLang === state.currentTargetLang) return;
      state.currentTargetLang = nextTargetLang;
      debug(`target atualizado para ${nextTargetLang}`);
    },

    close() {
      state.isClosed = true;
      state.callId = null;
      state.answerSdp = null;
    },

    get callId() {
      return state.callId;
    },

    get targetLanguage() {
      return state.currentTargetLang;
    },

    get isClosed() {
      return state.isClosed;
    },
  };
}
