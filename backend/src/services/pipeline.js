import { transcribeAudio } from './stt.js';
import { translateText } from './translate.js';
import { synthesizeSpeech } from './tts.js';

/**
 * Pipeline: Deepgram STT → DeepL Translate → Inworld AI TTS
 */
export async function processAudioPipeline(audioBuffer, sourceLang, targetLang) {
  if (sourceLang === targetLang) return audioBuffer;

  const t0 = Date.now();

  // 1. STT (Deepgram Nova-3)
  const transcript = await transcribeAudio(audioBuffer, sourceLang);
  if (!transcript || transcript.trim().length < 2) return null;
  const t1 = Date.now();

  // 2. Tradução (DeepL)
  const translated = await translateText(transcript, sourceLang, targetLang);
  if (!translated || translated.trim().length === 0) return null;
  const t2 = Date.now();

  // 3. TTS (Inworld AI)
  const audioResult = await synthesizeSpeech(translated, targetLang);
  const t3 = Date.now();

  console.log(`[Pipeline] "${transcript}" → "${translated}" | STT:${t1-t0}ms Translate:${t2-t1}ms TTS:${t3-t2}ms Total:${t3-t0}ms`);
  return audioResult;
}
