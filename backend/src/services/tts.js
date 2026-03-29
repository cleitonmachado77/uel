/**
 * Text-to-Speech usando Inworld AI TTS 1.5 Mini (ultra-low latency ~120ms)
 * https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech
 *
 * Busca vozes nativas por idioma na inicialização.
 * Vozes preset (Dennis, Alex, etc.) são inglesas — cross-language degrada qualidade.
 */

const INWORLD_API_KEY = process.env.INWORLD_API_KEY;

// Cache de vozes por idioma (preenchido na primeira chamada)
let voiceCache = null;

// Fallback caso a API de vozes falhe
const FALLBACK_VOICE = 'Dennis';

/**
 * Busca vozes disponíveis na API e agrupa por idioma.
 * Retorna Map<langCode, voiceId>
 */
async function fetchVoiceMap() {
  if (voiceCache) return voiceCache;

  try {
    const response = await fetch('https://api.inworld.ai/tts/v1/voices', {
      headers: { 'Authorization': `Basic ${INWORLD_API_KEY}` },
    });

    if (!response.ok) {
      console.warn('[TTS] Failed to fetch voices, using fallback');
      voiceCache = new Map();
      return voiceCache;
    }

    const data = await response.json();
    const map = new Map();

    for (const voice of (data.voices || [])) {
      if (voice.isCustom) continue;
      for (const lang of (voice.languages || [])) {
        // Primeira voz encontrada por idioma (preferência ao primeiro resultado)
        if (!map.has(lang)) {
          map.set(lang, voice.voiceId);
        }
      }
    }

    console.log('[TTS] Voice map loaded:', Object.fromEntries(map));
    voiceCache = map;
    return map;
  } catch (err) {
    console.warn('[TTS] Voice fetch error:', err.message);
    voiceCache = new Map();
    return voiceCache;
  }
}

export async function synthesizeSpeech(text, language = 'en') {
  if (!text || text.trim().length === 0) {
    throw new Error('TTS: texto vazio');
  }

  const voices = await fetchVoiceMap();
  const voiceId = voices.get(language) || FALLBACK_VOICE;

  try {
    const response = await fetch('https://api.inworld.ai/tts/v1/voice', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${INWORLD_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: text.substring(0, 2000),
        voiceId,
        modelId: 'inworld-tts-1.5-mini',
        audioConfig: {
          audioEncoding: 'MP3',
          sampleRateHertz: 24000,
        },
        talkingSpeed: 0.85,
        temperature: 0.8,          // Inworld recomenda 0.8–1.0 para real-time
        applyTextNormalization: 'ON',
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Inworld TTS error (${response.status}): ${err.substring(0, 300)}`);
    }

    const data = await response.json();

    if (!data.audioContent) {
      throw new Error('Inworld TTS: resposta sem audioContent');
    }

    console.log(`[TTS] voice=${voiceId} lang=${language} text="${text.substring(0, 60)}..."`);
    return Buffer.from(data.audioContent, 'base64');
  } catch (err) {
    console.error('TTS error:', err.message);
    throw err;
  }
}
