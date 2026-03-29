/**
 * STT + Tradução combinados usando Deepgram + DeepL
 * Substitui a abordagem anterior que usava Gemini para ambos.
 */

import { transcribeAudio } from './stt.js';
import { translateText } from './translate.js';

export async function transcribeAndTranslate(audioBuffer, sourceLang, targetLang) {
  if (audioBuffer.length < 1000) return { transcript: '', translated: '' };

  try {
    // 1. STT via Deepgram
    const transcript = await transcribeAudio(audioBuffer, sourceLang);

    if (!transcript || transcript.trim().length < 2) {
      return { transcript: '', translated: '' };
    }

    // 2. Tradução via DeepL
    let translated = '';
    if (sourceLang !== targetLang) {
      translated = await translateText(transcript, sourceLang, targetLang);
    } else {
      translated = transcript;
    }

    return { transcript: transcript.trim(), translated: translated.trim() };
  } catch (err) {
    console.error('STT+Translate error:', err.message || err);
    return { transcript: '', translated: '' };
  }
}
