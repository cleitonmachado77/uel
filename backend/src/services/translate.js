const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash-lite';

const LANG_NAMES = {
  pt: 'Portuguese', en: 'English', es: 'Spanish', fr: 'French',
  de: 'German', it: 'Italian', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
};

export async function translateText(text, sourceLang, targetLang) {
  const targetName = LANG_NAMES[targetLang] || targetLang;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GOOGLE_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: `Translate to ${targetName}. Return ONLY the translation:\n${text}` }],
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Translation error: ${err.substring(0, 200)}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}
