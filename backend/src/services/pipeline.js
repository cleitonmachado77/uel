import { translateText } from './translate.js';
import { synthesizeSpeech } from './tts.js';

// Timeout helper
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms)
    ),
  ]);
}

/**
 * Translate + TTS para um idioma alvo.
 * Recebe o transcript já pronto do stream Deepgram.
 */
export async function translateAndSpeak(transcript, sourceLang, targetLang) {
  const t0 = Date.now();

  const translated = await withTimeout(
    translateText(transcript, sourceLang, targetLang), 3000, 'Translate'
  );
  if (!translated || translated.trim().length === 0) return null;
  const t1 = Date.now();

  const audioResult = await withTimeout(
    synthesizeSpeech(translated, targetLang), 5000, 'TTS'
  );
  const t2 = Date.now();

  console.log(`[Pipeline] "${transcript}" → "${translated}" | Translate:${t1 - t0}ms TTS:${t2 - t1}ms Total:${t2 - t0}ms`);
  return audioResult;
}
