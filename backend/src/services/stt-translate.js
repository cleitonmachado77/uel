const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash-lite';

const LANG_NAMES = {
  pt: 'Portuguese', en: 'English', es: 'Spanish', fr: 'French',
  de: 'German', it: 'Italian', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
};

// Cache das últimas 10 transcrições pra detectar repetições/alucinações
const recentTranscripts = [];
const MAX_RECENT = 10;

// Frases conhecidas que o Gemini alucina
const HALLUCINATION_PATTERNS = [
  /grande fã de música/i,
  /não sei se você/i,
  /vai gostar/i,
  /bolo de chocolate/i,
  /obrigado por ter vindo/i,
  /o que é que você quer/i,
  /going to go to the store/i,
  /big fan of music/i,
];

export async function transcribeAndTranslate(audioBuffer, sourceLang, targetLang) {
  if (audioBuffer.length < 1000) return { transcript: '', translated: '' };

  const audioBase64 = Buffer.from(audioBuffer).toString('base64');
  const sourceName = LANG_NAMES[sourceLang] || 'Portuguese';
  const targetName = LANG_NAMES[targetLang] || 'English';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GOOGLE_API_KEY}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'audio/webm', data: audioBase64 } },
            { text: `Transcribe only ${sourceName} speech, translate to ${targetName}. No timestamps. Silence=NONE\nT: text\nR: translation` },
          ],
        }],
        generationConfig: { temperature: 0.0, maxOutputTokens: 150 },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('STT+Translate error:', err.substring(0, 200));
      return { transcript: '', translated: '' };
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    if (!text || text === 'NONE' || text.includes('NONE')) {
      return { transcript: '', translated: '' };
    }

    const tMatch = text.match(/^T:\s*(.+)/m);
    const rMatch = text.match(/^R:\s*(.+)/m);

    let transcript = tMatch?.[1]?.trim() || '';
    let translated = rMatch?.[1]?.trim() || '';

    transcript = cleanTimestamps(transcript);
    translated = cleanTimestamps(translated);

    if (!transcript || transcript.length < 2) return { transcript: '', translated: '' };

    // Filtra timestamps puros
    if (/^\d[\d\s:.,>-]+$/.test(transcript)) return { transcript: '', translated: '' };

    // Filtra alucinações conhecidas
    if (HALLUCINATION_PATTERNS.some(p => p.test(transcript))) {
      return { transcript: '', translated: '' };
    }

    // Filtra frases em inglês quando source é português
    if (sourceLang === 'pt' && /^(I'm|I am|The |It's|He |She |They |We |You |This is|Going to|Let me|I have|I want|I need)/i.test(transcript)) {
      return { transcript: '', translated: '' };
    }

    // Filtra frases muito longas pra 2s de áudio (max ~15 palavras)
    if (transcript.split(/\s+/).length > 15) {
      return { transcript: '', translated: '' };
    }

    // Filtra duplicatas recentes
    if (recentTranscripts.includes(transcript)) {
      return { transcript: '', translated: '' };
    }
    recentTranscripts.push(transcript);
    if (recentTranscripts.length > MAX_RECENT) recentTranscripts.shift();

    return { transcript, translated };
  } catch (err) {
    console.error('STT+Translate error:', err.message || err);
    return { transcript: '', translated: '' };
  }
}

function cleanTimestamps(text) {
  if (!text) return '';
  return text
    .replace(/\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}/g, '')
    .replace(/\b\d{2}:\d{2}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
