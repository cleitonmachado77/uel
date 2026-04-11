const INWORLD_API_KEY = process.env.INWORLD_API_KEY;
const INWORLD_WEBRTC_API_BASE_URL = 'https://api.inworld.ai';

const DEFAULT_TARGET_LANG = 'en';

const TARGET_LANGUAGE_MAP = {
  en: 'inglês (US)',
  es: 'espanhol (ES)',
  fr: 'francês (FR)',
  de: 'alemão (DE)',
  it: 'italiano (IT)',
  ja: 'japonês (JA)',
  ko: 'coreano (KO)',
  zh: 'chinês mandarim (ZH)',
  pt: 'português (Brasil)',
};

export function buildTranslatorInstructions(targetLang) {
  const humanTarget = TARGET_LANGUAGE_MAP[targetLang] || TARGET_LANGUAGE_MAP[DEFAULT_TARGET_LANG];
  const strictTargetRule = targetLang === 'fr'
    ? 'Responda SOMENTE em francês (França). Nunca use inglês.'
    : `Responda SOMENTE em ${humanTarget}. Nunca use inglês, exceto se o idioma alvo for inglês.`;
  return `Você é um tradutor simultâneo profissional. O usuário fala em português (Brasil). Traduza imediatamente tudo que ele disser para ${humanTarget}, falando de forma natural, fluida e mantendo o tom emocional original. Seja conciso e natural. Nunca adicione explicações. Responda sempre em voz falada. Nunca diga a palavra "Voice" ou "voz". ${strictTargetRule}`;
}

export function buildRealtimeSessionConfig({ instructions, voice = 'Dennis', speed = 1.0 }) {
  return {
    type: 'realtime',
    instructions,
    output_modalities: ['text', 'audio'],
    audio: {
      input: {
        transcription: {
          model: 'assemblyai/universal-streaming-multilingual',
        },
        turn_detection: {
          type: 'semantic_vad',
          eagerness: 'medium',
          create_response: true,
          interrupt_response: true,
        },
      },
      output: {
        voice,
        speed,
      },
    },
  };
}

/**
 * Stateless HTTP helper to proxy requests to the Inworld WebRTC API.
 * No shared state is kept between calls.
 */
export async function requestInworldWebRTC(path, { method = 'GET', body } = {}) {
  if (!INWORLD_API_KEY) {
    throw new Error('INWORLD_API_KEY nao definida');
  }

  const response = await fetch(`${INWORLD_WEBRTC_API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${INWORLD_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const responseText = await response.text();
  let payload = null;
  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch (_) {
    payload = responseText || null;
  }

  if (!response.ok) {
    const details = payload?.error?.message || payload?.message || responseText || response.statusText;
    throw new Error(`Inworld WebRTC ${method} ${path} falhou (${response.status}): ${details}`);
  }

  return payload;
}
