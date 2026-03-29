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

/**
 * Detecta o formato do áudio pelo magic number do buffer.
 * Retorna a config adequada para o Google Speech API.
 */
function detectAudioEncoding(audioBuffer) {
  const buf = Buffer.from(audioBuffer);

  // WebM: começa com 0x1A45DFA3 (EBML header)
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { encoding: 'WEBM_OPUS', sampleRateHertz: 48000 };
  }

  // MP4/M4A/AAC container: "ftyp" signature at offset 4
  if (buf.length >= 8 && buf.toString('ascii', 4, 8) === 'ftyp') {
    // MP4 container — Google STT não suporta diretamente, usamos encoding AUTO
    return { encoding: 'ENCODING_UNSPECIFIED', sampleRateHertz: 48000 };
  }

  // OGG: "OggS"
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'OggS') {
    return { encoding: 'OGG_OPUS', sampleRateHertz: 48000 };
  }

  // Fallback: deixa o Google tentar detectar
  return { encoding: 'ENCODING_UNSPECIFIED', sampleRateHertz: 48000 };
}

export async function transcribeAudio(audioBuffer, language = 'pt') {
  if (audioBuffer.length < 1000) return '';

  const audioBase64 = Buffer.from(audioBuffer).toString('base64');
  const { encoding, sampleRateHertz } = detectAudioEncoding(audioBuffer);
  const url = `https://speech.googleapis.com/v1/speech:recognize?key=${GOOGLE_API_KEY}`;

  console.log(`[STT] Detected encoding: ${encoding}, buffer size: ${audioBuffer.length}`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          encoding,
          sampleRateHertz,
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
