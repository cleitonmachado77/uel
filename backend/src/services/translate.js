/**
 * Tradução usando Google Cloud Translation API v2
 * https://cloud.google.com/translate/docs/reference/rest/v2/translate
 */

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// Google usa códigos ISO 639-1 simples
const GOOGLE_LANG_CODES = {
  pt: 'pt',
  en: 'en',
  es: 'es',
  fr: 'fr',
  de: 'de',
  it: 'it',
  ja: 'ja',
  ko: 'ko',
  zh: 'zh-CN',
};

export async function translateText(text, sourceLang, targetLang) {
  if (!text || sourceLang === targetLang) return text;

  const source = GOOGLE_LANG_CODES[sourceLang] || sourceLang;
  const target = GOOGLE_LANG_CODES[targetLang] || targetLang;

  try {
    const response = await fetch(
      `https://translation.googleapis.com/language/translate/v2?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: text, source, target, format: 'text' }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Google Translate error (${response.status}): ${err.substring(0, 200)}`);
    }

    const data = await response.json();
    return data.data?.translations?.[0]?.translatedText?.trim() || '';
  } catch (err) {
    console.error('Translation error:', err.message);
    throw err;
  }
}
