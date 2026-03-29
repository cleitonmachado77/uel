/**
 * Speech-to-Text usando Deepgram Nova-3
 * https://developers.deepgram.com/docs/stt/getting-started
 */

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

const LANG_CODES = {
  pt: 'pt-BR',
  en: 'en-US',
  es: 'es',
  fr: 'fr',
  de: 'de',
  it: 'it',
  ja: 'ja',
  ko: 'ko',
  zh: 'zh',
};

/**
 * Detecta o content-type do áudio pelo magic number do buffer.
 */
function detectContentType(audioBuffer) {
  const buf = Buffer.from(audioBuffer);

  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return 'audio/webm';
  }
  if (buf.length >= 8 && buf.toString('ascii', 4, 8) === 'ftyp') {
    return 'audio/mp4';
  }
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'OggS') {
    return 'audio/ogg';
  }
  return 'audio/webm';
}

export async function transcribeAudio(audioBuffer, language = 'pt') {
  if (audioBuffer.length < 1000) return '';

  const contentType = detectContentType(audioBuffer);
  const langCode = LANG_CODES[language] || 'pt-BR';

  const url = new URL('https://api.deepgram.com/v1/listen');
  url.searchParams.set('model', 'nova-3');
  url.searchParams.set('language', langCode);
  url.searchParams.set('punctuate', 'true');

  console.log(`[STT/Deepgram] content-type: ${contentType}, lang: ${langCode}, buffer: ${audioBuffer.length} bytes`);

  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': contentType,
      },
      body: Buffer.from(audioBuffer),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Deepgram STT error:', err.substring(0, 300));
      return '';
    }

    const data = await response.json();
    const alt = data.results?.channels?.[0]?.alternatives?.[0];
    const transcript = alt?.transcript || '';
    const confidence = alt?.confidence ?? 0;

    // Descarta transcrições com baixa confiança (ruído/silêncio interpretado como fala)
    if (confidence < 0.6) {
      console.log(`[STT/Deepgram] Low confidence (${confidence.toFixed(2)}), discarding: "${transcript}"`);
      return '';
    }

    return transcript.trim();
  } catch (err) {
    console.error('STT error:', err.message);
    return '';
  }
}
