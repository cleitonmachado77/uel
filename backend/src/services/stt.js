const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

const LANG_CODES = {
  pt: 'pt-BR',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  ja: 'ja-JP',
  ko: 'ko-KR',
  zh: 'cmn-Hans-CN',
};

export async function transcribeAudio(audioBuffer, language = 'pt') {
  if (audioBuffer.length < 1000) return '';

  const audioBase64 = Buffer.from(audioBuffer).toString('base64');
  const url = `https://speech.googleapis.com/v1/speech:recognize?key=${GOOGLE_API_KEY}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          encoding: 'WEBM_OPUS',
          sampleRateHertz: 48000,
          languageCode: LANG_CODES[language] || 'pt-BR',
          enableAutomaticPunctuation: true,
        },
        audio: { content: audioBase64 },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Google STT error:', err.substring(0, 200));
      return '';
    }

    const data = await response.json();
    const transcript = data.results
      ?.map((r) => r.alternatives?.[0]?.transcript)
      .filter(Boolean)
      .join(' ');

    return transcript || '';
  } catch (err) {
    console.error('STT error:', err.message);
    return '';
  }
}
