const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

const VOICE_MAP = {
  en: { languageCode: 'en-US', name: 'en-US-Standard-C' },
  es: { languageCode: 'es-ES', name: 'es-ES-Standard-A' },
  fr: { languageCode: 'fr-FR', name: 'fr-FR-Standard-A' },
  de: { languageCode: 'de-DE', name: 'de-DE-Standard-A' },
  it: { languageCode: 'it-IT', name: 'it-IT-Standard-A' },
  pt: { languageCode: 'pt-BR', name: 'pt-BR-Standard-A' },
  ja: { languageCode: 'ja-JP', name: 'ja-JP-Standard-A' },
  ko: { languageCode: 'ko-KR', name: 'ko-KR-Standard-A' },
  zh: { languageCode: 'cmn-CN', name: 'cmn-CN-Standard-A' },
};

export async function synthesizeSpeech(text, language = 'en') {
  const voice = VOICE_MAP[language] || VOICE_MAP.en;
  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: voice.languageCode, name: voice.name },
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1.15 },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`TTS error: ${err.substring(0, 200)}`);
  }

  const data = await response.json();
  return Buffer.from(data.audioContent, 'base64');
}
