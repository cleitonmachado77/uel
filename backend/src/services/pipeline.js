import { transcribeAudio } from './stt.js';
import { translateText } from './translate.js';
import { synthesizeSpeech } from './tts.js';

// Timeout helper — aborta se a API demorar demais
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms)
    ),
  ]);
}

/**
 * Pipeline STT apenas — retorna o transcript ou null.
 * Chamado uma vez por chunk de áudio.
 */
export async function transcribeChunk(audioBuffer, sourceLang) {
  const transcript = await withTimeout(
    transcribeAudio(audioBuffer, sourceLang), 5000, 'STT'
  );
  if (!transcript || transcript.trim().length < 2) return null;

  // Filtra transcrições que são apenas pontuação, repetição ou ruído
  const cleaned = transcript.replace(/[.,!?;:\-–—…\s]/g, '');
  if (cleaned.length < 2) return null;

  return transcript;
}

/**
 * Pipeline Translate + TTS para um idioma alvo.
 * Recebe o transcript já pronto (evita STT duplicado).
 */
export async function translateAndSpeak(transcript, sourceLang, targetLang) {
  const t0 = Date.now();

  const translated = await withTimeout(
    translateText(transcript, sourceLang, targetLang), 4000, 'Translate'
  );
  if (!translated || translated.trim().length === 0) return null;
  const t1 = Date.now();

  const audioResult = await withTimeout(
    synthesizeSpeech(translated, targetLang), 5000, 'TTS'
  );
  const t2 = Date.now();

  console.log(`[Pipeline] "${transcript}" → "${translated}" | Translate:${t1-t0}ms TTS:${t2-t1}ms Total:${t2-t0}ms`);
  return audioResult;
}
