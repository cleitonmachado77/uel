/**
 * Speech-to-Text usando Deepgram Live Streaming (Nova-3)
 * https://developers.deepgram.com/docs/getting-started-with-live-streaming-audio
 *
 * Modo streaming com interim_results para reduzir latência.
 * Cada sessão de professor mantém uma conexão WebSocket persistente com Deepgram.
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
 * Retorna um objeto com métodos para enviar áudio e fechar a conexão.
 *
 * @param {string} language - código de idioma (pt, en, es...)
 * @param {function} onTranscript - callback(transcript: string, isFinal: boolean)
 * @param {function} onError - callback(err: Error)
 */
export function createDeepgramStream(language = 'pt', encoding, onTranscript, onError) {
  const langCode = LANG_CODES[language] || 'pt-BR';

  const params = new URLSearchParams({
    model: 'nova-2',
    language: langCode,
    punctuate: 'true',
    interim_results: 'true',
    endpointing: '300',
    utterance_end_ms: '1000',
    vad_events: 'true',
  });

  // Informa o encoding ao Deepgram se conhecido — melhora reconhecimento
  if (encoding) params.set('encoding', encoding);

  const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
  console.log(`[STT/Deepgram] Conectando: ${url}`);

  const ws = new WebSocket(url, {
    headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
  });

  let isOpen = false;
  let pendingChunks = [];
  let lastAudioAt = Date.now();

  // Keepalive: envia KeepAlive JSON a cada 5s para evitar timeout do Deepgram (10s)
  const keepaliveInterval = setInterval(() => {
    if (!isOpen) return;
    const idleMs = Date.now() - lastAudioAt;
    if (idleMs >= 4000) {
      ws.send(JSON.stringify({ type: 'KeepAlive' }));
      console.log('[STT/Deepgram] KeepAlive enviado');
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

        console.log(`[STT/Deepgram] Results: isFinal=${isFinal} confidence=${confidence.toFixed(2)} transcript="${transcript}"`);

        if (!transcript || transcript.length < 2) return;

        // Para interinos, exige confiança alta (evita ruído mas não descarta fala real)
        if (!isFinal && confidence < 0.85) return;

        const cleaned = transcript.replace(/[.,!?;:\-–—…\s]/g, '');
        if (cleaned.length < 2) return;

        onTranscript(transcript, isFinal);
      }

      if (msg.type === 'SpeechStarted') {
        console.log('[STT/Deepgram] Fala detectada');
      }

      if (msg.type === 'UtteranceEnd') {
        console.log('[STT/Deepgram] UtteranceEnd recebido');
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
    clearInterval(keepaliveInterval);
    console.log(`[STT/Deepgram] Stream fechado code=${code} reason=${reason?.toString()}`);
  });

  return {
    /**
     * Envia chunk de áudio para o Deepgram.
     * @param {Buffer} audioBuffer
     */
    send(audioBuffer) {
      lastAudioAt = Date.now();
      if (isOpen) {
        ws.send(audioBuffer);
      } else if (ws.readyState === WebSocket.CONNECTING) {
        pendingChunks.push(audioBuffer);
      }
    },

    /**
     * Sinaliza fim de stream para o Deepgram e fecha a conexão.
     */
    close() {
      clearInterval(keepaliveInterval);
      if (isOpen) {
        ws.send(JSON.stringify({ type: 'CloseStream' }));
        setTimeout(() => ws.terminate(), 1000);
      } else {
        ws.terminate();
      }
    },

    get readyState() {
      return ws.readyState;
    },
  };
}

/**
 * Mantém compatibilidade com o modo batch (usado em stt-translate.js).
 * Faz uma transcrição única via REST para casos pontuais.
 */
export async function transcribeAudio(audioBuffer, language = 'pt') {
  if (audioBuffer.length < 1000) return '';

  const langCode = LANG_CODES[language] || 'pt-BR';

  // Detecta content-type pelo magic number
  const buf = Buffer.from(audioBuffer);
  let contentType = 'audio/webm';
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45) contentType = 'audio/webm';
  else if (buf.length >= 8 && buf.toString('ascii', 4, 8) === 'ftyp') contentType = 'audio/mp4';
  else if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'OggS') contentType = 'audio/ogg';

  const url = new URL('https://api.deepgram.com/v1/listen');
  url.searchParams.set('model', 'nova-3');
  url.searchParams.set('language', langCode);
  url.searchParams.set('punctuate', 'true');

  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': contentType,
      },
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
