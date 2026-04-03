/**
 * Tradução usando Google Cloud Translation API v2
 * https://cloud.google.com/translate/docs/reference/rest/v2/translate
 */

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

const GOOGLE_LANG_CODES = {
  pt: 'pt', en: 'en', es: 'es', fr: 'fr', de: 'de',
  it: 'it', ja: 'ja', ko: 'ko', zh: 'zh-CN',
};

// Cache LRU simples — evita re-traduzir frases repetidas (comum em aulas)
const MAX_CACHE = 200;
const translateCache = new Map();

function cacheGet(key) {
  const val = translateCache.get(key);
  if (!val) return null;
  // Move para o fim (LRU)
  translateCache.delete(key);
  translateCache.set(key, val);
  return val;
}

function cacheSet(key, val) {
  if (translateCache.size >= MAX_CACHE) {
    // Remove o mais antigo
    translateCache.delete(translateCache.keys().next().value);
  }
  translateCache.set(key, val);
}

export async function translateText(text, sourceLang, targetLang) {
  if (!text || sourceLang === targetLang) return text;

  const source = GOOGLE_LANG_CODES[sourceLang] || sourceLang;
  const target = GOOGLE_LANG_CODES[targetLang] || targetLang;
  const cacheKey = `${source}|${target}|${text}`;

  const cached = cacheGet(cacheKey);
  if (cached) return cached;

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
    const result = data.data?.translations?.[0]?.translatedText?.trim() || '';
    if (result) cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.error('Translation error:', err.message);
    throw err;
  }
}
