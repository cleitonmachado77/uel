import { transcribeAudio } from './stt.js';
import { translateText } from './translate.js';
import { synthesizeSpeech } from './tts.js';

/**
 * Pipeline: ElevenLabs STT → Gemini Translate → ElevenLabs TTS
 */
export async function processAudioPipeline(audioBuffer, sourceLang, targetLang) {
  if (sourceLang === targetLang) return audioBuffer;

  // 1. STT (ElevenLabs Scribe v2)
  const transcript = await transcribeAudio(audioBuffer, sourceLang);
  if (!transcript || transcript.trim().length < 2) return null;
  
  // 2. Tradução (Gemini)
  const translated = await translateText(transcript, sourceLang, targetLang);
  if (!translated || translated.trim().length === 0) return null;
  
  console.log(`[Pipeline] "${transcript}" → "${translated}"`);

  // 3. TTS (ElevenLabs)
  const audioResult = await synthesizeSpeech(translated, targetLang);
  console.log(`[Pipeline] TTS done (${audioResult.length} bytes)`);
  return audioResult;
}
