'use client';

import { useCallback, useRef, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const DEFAULT_TARGET_LANG = 'en';

const TARGET_LANGUAGE_MAP: Record<string, string> = {
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

function buildTranslatorInstructions(targetLang: string) {
  const humanTarget = TARGET_LANGUAGE_MAP[targetLang] || TARGET_LANGUAGE_MAP[DEFAULT_TARGET_LANG];
  const strictTargetRule = targetLang === 'fr'
    ? 'Responda SOMENTE em francês (França). Nunca use inglês.'
    : `Responda SOMENTE em ${humanTarget}. Nunca use inglês, exceto se o idioma alvo for inglês.`;

  return `Você é um tradutor simultâneo profissional. O usuário fala em português (Brasil). Traduza imediatamente tudo que ele disser para ${humanTarget}, falando de forma natural, fluida e mantendo o tom emocional original. Seja conciso e natural. Nunca adicione explicações. Responda sempre em voz falada. Nunca diga a palavra "Voice" ou "voz". ${strictTargetRule}`;
}

function buildSessionUpdate(targetLang: string) {
  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      instructions: buildTranslatorInstructions(targetLang),
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
          voice: 'Dennis',
          speed: 1.0,
        },
      },
    },
  };
}

async function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 3500) {
  if (pc.iceGatheringState === 'complete') return;

  await new Promise<void>((resolve) => {
    let done = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (done) return;
      done = true;
      if (timeoutId) clearTimeout(timeoutId);
      pc.removeEventListener('icegatheringstatechange', onStateChange);
      resolve();
    };

    const onStateChange = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };

    timeoutId = setTimeout(finish, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onStateChange);
  });
}

export type UseInworldWebRTCOptions = {
  onRemoteStream?: (stream: MediaStream | null) => void;
  onLocalStream?: (stream: MediaStream) => void;
  onDebug?: (message: string) => void;
  onError?: (error: Error) => void;
  maxReconnectAttempts?: number;
};

export function useInworldWebRTC(options: UseInworldWebRTCOptions = {}) {
  // Store callbacks in a ref so internal functions always see the latest
  // version without needing them in useCallback dependency arrays.
  const optRef = useRef(options);
  optRef.current = options;

  const maxReconnect = options.maxReconnectAttempts ?? 4;

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const ownsLocalStreamRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isConnectingRef = useRef(false);
  const activeInitIdRef = useRef(0);
  const stoppingRef = useRef(false);
  const lastTargetLangRef = useRef(DEFAULT_TARGET_LANG);
  const lastAudioSourceRef = useRef<MediaStream | undefined>(undefined);
  const initFnRef = useRef<(lang: string, src?: MediaStream) => Promise<void>>();

  const debug = useCallback(
    (message: string) => optRef.current.onDebug?.(`[InworldWebRTC] ${message}`),
    [],
  );

  const clearReconnectTimer = useCallback(() => {
    if (!reconnectTimerRef.current) return;
    clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }, []);

  const cleanupPeer = useCallback(() => {
    dcRef.current?.close();
    dcRef.current = null;

    if (pcRef.current) {
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }

    if (localStreamRef.current && ownsLocalStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
      }
    }
    localStreamRef.current = null;
    ownsLocalStreamRef.current = false;

    optRef.current.onRemoteStream?.(null);
  }, []);

  const scheduleReconnect = useCallback((targetLang: string) => {
    if (stoppingRef.current || isConnectingRef.current || reconnectTimerRef.current) return;
    if (reconnectAttemptsRef.current >= maxReconnect) {
      optRef.current.onError?.(new Error('Limite de reconexão do WebRTC atingido'));
      return;
    }

    reconnectAttemptsRef.current += 1;
    const delayMs = Math.min(1000 * (2 ** (reconnectAttemptsRef.current - 1)), 8000);
    debug(`reconectando em ${delayMs}ms (tentativa ${reconnectAttemptsRef.current})`);

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      initFnRef.current?.(targetLang, lastAudioSourceRef.current).catch(() => {});
    }, delayMs);
  }, [debug, maxReconnect]);

  const sendEvent = useCallback((event: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== 'open') {
      return false;
    }
    dc.send(JSON.stringify(event));
    return true;
  }, []);

  const init = useCallback(async (targetLang = DEFAULT_TARGET_LANG, audioSource?: MediaStream) => {
    if (isConnectingRef.current) return;

    const initId = activeInitIdRef.current + 1;
    activeInitIdRef.current = initId;

    stoppingRef.current = false;
    clearReconnectTimer();
    isConnectingRef.current = true;
    setIsConnecting(true);
    setIsConnected(false);
    lastTargetLangRef.current = targetLang;
    lastAudioSourceRef.current = audioSource;

    try {
      cleanupPeer();

      debug('buscando ICE servers...');
      const iceRes = await fetch(`${API_URL}/api/realtime/ice-servers`);
      if (!iceRes.ok) {
        throw new Error(`Falha ao obter ICE servers (${iceRes.status})`);
      }
      const icePayload = await iceRes.json();
      const iceServers = icePayload?.ice_servers || [];

      let stream: MediaStream;
      if (audioSource) {
        stream = audioSource;
        ownsLocalStreamRef.current = false;
        debug('usando audioSource externo');
      } else {
        debug('solicitando acesso ao microfone...');
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        });
        ownsLocalStreamRef.current = true;
        optRef.current.onLocalStream?.(stream);
      }

      if (activeInitIdRef.current !== initId || stoppingRef.current) return;

      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;
      localStreamRef.current = stream;

      const dc = pc.createDataChannel('oai-events', { ordered: true });
      dcRef.current = dc;

      dc.onopen = () => {
        if (activeInitIdRef.current !== initId) return;
        reconnectAttemptsRef.current = 0;
        setIsConnected(true);
        debug('data channel aberto');
        sendEvent(buildSessionUpdate(lastTargetLangRef.current));
      };

      dc.onclose = () => {
        if (activeInitIdRef.current !== initId) return;
        setIsConnected(false);
        if (!stoppingRef.current && pc.currentRemoteDescription) {
          scheduleReconnect(lastTargetLangRef.current);
        }
      };

      dc.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'error') {
            optRef.current.onError?.(new Error(msg.error?.message || msg.message || 'Erro Inworld'));
          }
        } catch (_) {}
      };

      stream.getAudioTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      pc.ontrack = (event) => {
        const remoteStream = event.streams?.[0] || new MediaStream([event.track]);
        optRef.current.onRemoteStream?.(remoteStream);
      };

      pc.onconnectionstatechange = () => {
        if (!pcRef.current || activeInitIdRef.current !== initId) return;
        const st = pc.connectionState;
        debug(`connectionState=${st}`);
        if (st === 'connected') {
          reconnectAttemptsRef.current = 0;
          setIsConnected(true);
          return;
        }
        if (!pc.currentRemoteDescription) return;
        if (st === 'failed' || st === 'disconnected') {
          setIsConnected(false);
          if (!stoppingRef.current) scheduleReconnect(lastTargetLangRef.current);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);

      debug('enviando SDP offer para o backend...');
      const callRes = await fetch(`${API_URL}/api/realtime/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sdp: pc.localDescription?.sdp,
          targetLang,
        }),
      });

      if (!callRes.ok) {
        throw new Error(`Falha ao criar call WebRTC (${callRes.status})`);
      }

      const callPayload = await callRes.json();
      if (!callPayload?.sdp) {
        throw new Error('Resposta sem SDP answer');
      }

      if (activeInitIdRef.current !== initId || stoppingRef.current || pc.signalingState === 'closed') {
        return;
      }

      await pc.setRemoteDescription({
        type: 'answer',
        sdp: callPayload.sdp,
      });

      debug('WebRTC conectado com sucesso');
    } catch (err) {
      const parsedErr = err instanceof Error ? err : new Error('Falha ao iniciar WebRTC');
      optRef.current.onError?.(parsedErr);
      if (!stoppingRef.current) {
        scheduleReconnect(targetLang);
      }
      throw parsedErr;
    } finally {
      if (activeInitIdRef.current === initId) {
        isConnectingRef.current = false;
      }
      setIsConnecting(false);
    }
  }, [cleanupPeer, clearReconnectTimer, scheduleReconnect, sendEvent, debug]);

  // Keep ref in sync so scheduleReconnect always calls the latest init
  initFnRef.current = init;

  const updateTargetLanguage = useCallback((targetLang: string) => {
    if (!targetLang) return;
    lastTargetLangRef.current = targetLang;
    sendEvent(buildSessionUpdate(targetLang));
  }, [sendEvent]);

  const stop = useCallback(() => {
    stoppingRef.current = true;
    activeInitIdRef.current += 1;
    isConnectingRef.current = false;
    clearReconnectTimer();
    reconnectAttemptsRef.current = 0;
    setIsConnected(false);
    setIsConnecting(false);
    cleanupPeer();
  }, [cleanupPeer, clearReconnectTimer]);

  return {
    isConnected,
    isConnecting,
    init,
    stop,
    updateTargetLanguage,
    sendEvent,
  };
}
