/**
 * Speech-to-Text usando Deepgram Live Streaming (Nova-2)
 */

import { WebSocket } from 'ws';

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

const LANG_CODES = {
  pt: 'pt-BR',
  en: 'en-US',
  es: 'es',
  fr: 'fr',
  de: 'de',
  it: 'it',
  ja: 'ja',
  ko: 'ko',
  zh: 'zh',
};

/**
 * Cria uma conexão de streaming com Deepgram.
 * NÃO passa encoding na URL — o Deepgram detecta automaticamente pelo container WebM.
 */
export function createDeepgramStream(language = 'pt', onTranscript, onError) {
  const langCode = LANG_CODES[language] || 'pt-BR';

  const params = new URLSearchParams({
    model: 'nova-2',
    language: langCode,
    punctuate: 'true',
    interim_results: 'true',
    endpointing: '150',       // 150ms de silêncio para finalizar (padrão é 10ms)
    utterance_end_ms: '1000', // mínimo suportado pela API é 1000ms
    vad_events: 'true',
  });

  const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
  console.log(`[STT/Deepgram] Conectando: ${url}`);

  const ws = new WebSocket(url, {
    headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
  });

  let isOpen = false;
  let pendingChunks = [];
  let lastAudioAt = Date.now();
  let closed = false;

  const keepaliveInterval = setInterval(() => {
    if (!isOpen || closed) return;
    const idleMs = Date.now() - lastAudioAt;
    if (idleMs >= 4000) {
      ws.send(JSON.stringify({ type: 'KeepAlive' }));
    }
  }, 5000);

  ws.on('open', () => {
    isOpen = true;
    console.log(`[STT/Deepgram] Stream aberto lang=${langCode}`);
    for (const chunk of pendingChunks) ws.send(chunk);
    pendingChunks = [];
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'Results') {
        const alt = msg.channel?.alternatives?.[0];
        const transcript = alt?.transcript?.trim();
        const isFinal = msg.is_final === true;
        const confidence = alt?.confidence ?? 0;

        if (!transcript || transcript.length < 2) return;
        if (!isFinal && confidence < 0.85) return;

        const cleaned = transcript.replace(/[.,!?;:\-–—…\s]/g, '');
        if (cleaned.length < 2) return;

        onTranscript(transcript, isFinal);
      }
    } catch (err) {
      console.error('[STT/Deepgram] Parse error:', err.message);
    }
  });

  ws.on('error', (err) => {
    console.error('[STT/Deepgram] Stream error:', err.message);
    onError?.(err);
  });

  ws.on('close', (code, reason) => {
    isOpen = false;
    closed = true;
    clearInterval(keepaliveInterval);
    console.log(`[STT/Deepgram] Stream fechado code=${code} reason=${reason?.toString()}`);
  });

  return {
    send(audioBuffer) {
      if (closed) return;
      lastAudioAt = Date.now();
      if (isOpen) {
        ws.send(audioBuffer);
      } else if (ws.readyState === WebSocket.CONNECTING) {
        pendingChunks.push(audioBuffer);
      }
    },

    close() {
      if (closed) return;
      closed = true;
      clearInterval(keepaliveInterval);
      if (isOpen) {
        try { ws.send(JSON.stringify({ type: 'CloseStream' })); } catch (_) {}
        setTimeout(() => { try { ws.terminate(); } catch (_) {} }, 1000);
      } else {
        try { ws.terminate(); } catch (_) {}
      }
    },

    get readyState() {
      return ws.readyState;
    },

    get isClosed() {
      return closed;
    },
  };
}

/**
 * Transcrição única via REST (usado em stt-translate.js).
 */
export async function transcribeAudio(audioBuffer, language = 'pt') {
  if (audioBuffer.length < 1000) return '';

  const langCode = LANG_CODES[language] || 'pt-BR';
  const buf = Buffer.from(audioBuffer);
  let contentType = 'audio/webm';
  if (buf.length >= 8 && buf.toString('ascii', 4, 8) === 'ftyp') contentType = 'audio/mp4';
  else if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'OggS') contentType = 'audio/ogg';

  const url = new URL('https://api.deepgram.com/v1/listen');
  url.searchParams.set('model', 'nova-2');
  url.searchParams.set('language', langCode);
  url.searchParams.set('punctuate', 'true');

  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { Authorization: `Token ${DEEPGRAM_API_KEY}`, 'Content-Type': contentType },
      body: buf,
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Deepgram STT error:', err.substring(0, 300));
      return '';
    }

    const data = await response.json();
    const alt = data.results?.channels?.[0]?.alternatives?.[0];
    const transcript = alt?.transcript || '';
    const confidence = alt?.confidence ?? 0;
    if (confidence < 0.4) return '';
    return transcript.trim();
  } catch (err) {
    console.error('STT error:', err.message);
    return '';
  }
}
