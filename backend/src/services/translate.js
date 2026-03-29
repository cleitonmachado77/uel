/**
 * Tradução usando DeepL API
 * https://developers.deepl.com/docs/api-reference/translate
 */

const DEEPL_API_KEY = process.env.DEEPL_API_KEY;

// DeepL usa códigos específicos para target_lang
const DEEPL_TARGET_CODES = {
  pt: 'PT-BR',
  en: 'EN-US',
  es: 'ES',
  fr: 'FR',
  de: 'DE',
  it: 'IT',
  ja: 'JA',
  ko: 'KO',
  zh: 'ZH-HANS',
};

// DeepL source_lang (sem variantes regionais)
const DEEPL_SOURCE_CODES = {
  pt: 'PT',
  en: 'EN',
  es: 'ES',
  fr: 'FR',
  de: 'DE',
  it: 'IT',
  ja: 'JA',
  ko: 'KO',
  zh: 'ZH',
};

/**
 * Determina a URL base do DeepL.
 * Chaves terminando em ":fx" usam a API Free.
 */
function getBaseUrl() {
  if (DEEPL_API_KEY && DEEPL_API_KEY.endsWith(':fx')) {
    return 'https://api-free.deepl.com';
  }
  return 'https://api.deepl.com';
}

export async function translateText(text, sourceLang, targetLang) {
  if (!text || sourceLang === targetLang) return text;

  const baseUrl = getBaseUrl();
  const targetCode = DEEPL_TARGET_CODES[targetLang] || 'EN-US';
  const sourceCode = DEEPL_SOURCE_CODES[sourceLang];

  const body = {
    text: [text],
    target_lang: targetCode,
  };

  // source_lang é opcional — DeepL auto-detecta se omitido
  if (sourceCode) {
    body.source_lang = sourceCode;
  }

  try {
    const response = await fetch(`${baseUrl}/v2/translate`, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`DeepL error (${response.status}): ${err.substring(0, 200)}`);
    }

    const data = await response.json();
    return data.translations?.[0]?.text?.trim() || '';
  } catch (err) {
    console.error('Translation error:', err.message);
    throw err;
  }
}
