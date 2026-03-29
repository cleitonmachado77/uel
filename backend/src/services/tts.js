/**
 * Text-to-Speech usando Inworld AI TTS 1.5 Mini (ultra-low latency ~120ms)
 * https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech
 */

const INWORLD_API_KEY = process.env.INWORLD_API_KEY;

const VOICE_MAP = {
  en: 'Dennis',
  es: 'Dennis',
  fr: 'Dennis',
  de: 'Dennis',
  it: 'Dennis',
  pt: 'Dennis',
  ja: 'Dennis',
  ko: 'Dennis',
  zh: 'Dennis',
};

export async function synthesizeSpeech(text, language = 'en') {
  if (!text || text.trim().length === 0) {
    throw new Error('TTS: texto vazio');
  }

  const voiceId = VOICE_MAP[language] || 'Dennis';

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
        modelId: 'inworld-tts-1.5-mini',  // mini = ~120ms vs ~200ms do max
        audioConfig: {
          audioEncoding: 'MP3',
          sampleRateHertz: 24000,  // 24kHz é suficiente para voz, menor payload
        },
        talkingSpeed: 0.85,        // 85% da velocidade normal — mais natural para aula
        temperature: 0.7,          // menos variação = mais estável e previsível
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

    return Buffer.from(data.audioContent, 'base64');
  } catch (err) {
    console.error('TTS error:', err.message);
    throw err;
  }
}
