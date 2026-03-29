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
 * Pipeline: Deepgram STT → DeepL Translate → Inworld AI TTS
 */
export async function processAudioPipeline(audioBuffer, sourceLang, targetLang) {
  if (sourceLang === targetLang) return audioBuffer;

  const t0 = Date.now();

  // 1. STT (Deepgram Nova-3) — timeout 5s
  const transcript = await withTimeout(
    transcribeAudio(audioBuffer, sourceLang), 5000, 'STT'
  );
  if (!transcript || transcript.trim().length < 2) return null;

  // Filtra transcrições que são apenas pontuação, repetição ou ruído
  const cleaned = transcript.replace(/[.,!?;:\-–—…\s]/g, '');
  if (cleaned.length < 2) return null;

  const t1 = Date.now();

  // 2. Tradução (DeepL) — timeout 4s
  const translated = await withTimeout(
    translateText(transcript, sourceLang, targetLang), 4000, 'Translate'
  );
  if (!translated || translated.trim().length === 0) return null;
  const t2 = Date.now();

  // 3. TTS (Inworld AI) — timeout 5s
  const audioResult = await withTimeout(
    synthesizeSpeech(translated, targetLang), 5000, 'TTS'
  );
  const t3 = Date.now();

  console.log(`[Pipeline] "${transcript}" → "${translated}" | STT:${t1-t0}ms Translate:${t2-t1}ms TTS:${t3-t2}ms Total:${t3-t0}ms`);
  return audioResult;
}
