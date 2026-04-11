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

type UseInworldWebRTCOptions = {
  onRemoteStream?: (stream: MediaStream | null) => void;
  onDebug?: (message: string) => void;
  onError?: (error: Error) => void;
  maxReconnectAttempts?: number;
};

export function useInworldWebRTC(options: UseInworldWebRTCOptions = {}) {
  const {
    onRemoteStream,
    onDebug,
    onError,
    maxReconnectAttempts = 4,
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isConnectingRef = useRef(false);
  const activeInitIdRef = useRef(0);
  const stoppingRef = useRef(false);
  const lastTargetLangRef = useRef(DEFAULT_TARGET_LANG);

  const debug = useCallback(
    (message: string) => onDebug?.(`[InworldWebRTC] ${message}`),
    [onDebug],
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

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
      }
      localStreamRef.current = null;
    }

    onRemoteStream?.(null);
  }, [onRemoteStream]);

  const scheduleReconnect = useCallback((targetLang: string) => {
    if (stoppingRef.current || isConnectingRef.current || reconnectTimerRef.current) return;
    if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
      const err = new Error('Limite de reconexão do WebRTC atingido');
      onError?.(err);
      return;
    }

    reconnectAttemptsRef.current += 1;
    const delayMs = Math.min(1000 * (2 ** (reconnectAttemptsRef.current - 1)), 8000);
    debug(`reconectando em ${delayMs}ms (tentativa ${reconnectAttemptsRef.current})`);

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      init(targetLang).catch(() => {});
    }, delayMs);
  }, [debug, maxReconnectAttempts, onError]);

  const sendEvent = useCallback((event: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== 'open') {
      return false;
    }
    dc.send(JSON.stringify(event));
    return true;
  }, []);

  const init = useCallback(async (targetLang = DEFAULT_TARGET_LANG) => {
    if (isConnectingRef.current) return;

    const initId = activeInitIdRef.current + 1;
    activeInitIdRef.current = initId;

    stoppingRef.current = false;
    clearReconnectTimer();
    isConnectingRef.current = true;
    setIsConnecting(true);
    setIsConnected(false);
    lastTargetLangRef.current = targetLang;

    try {
      cleanupPeer();

      const iceRes = await fetch(`${API_URL}/api/realtime/ice-servers`);
      if (!iceRes.ok) {
        throw new Error(`Falha ao obter ICE servers (${iceRes.status})`);
      }
      const icePayload = await iceRes.json();
      const iceServers = icePayload?.ice_servers || [];

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });

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
            onError?.(new Error(msg.error?.message || msg.message || 'Erro Inworld'));
          }
        } catch (_) {}
      };

      stream.getAudioTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      pc.ontrack = (event) => {
        const remoteStream = event.streams?.[0] || new MediaStream([event.track]);
        onRemoteStream?.(remoteStream);
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
        if (!pc.currentRemoteDescription) {
          return;
        }
        if (st === 'failed' || st === 'disconnected') {
          setIsConnected(false);
          if (!stoppingRef.current) scheduleReconnect(lastTargetLangRef.current);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);

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
    } catch (err) {
      const parsedErr = err instanceof Error ? err : new Error('Falha ao iniciar WebRTC');
      onError?.(parsedErr);
      scheduleReconnect(targetLang);
      throw parsedErr;
    } finally {
      if (activeInitIdRef.current === initId) {
        isConnectingRef.current = false;
      }
      setIsConnecting(false);
    }
  }, [cleanupPeer, clearReconnectTimer, onError, onRemoteStream, scheduleReconnect, sendEvent, debug]);

  const updateTargetLanguage = useCallback((targetLang: string) => {
    if (!targetLang) return;
    lastTargetLangRef.current = targetLang;
    const sent = sendEvent(buildSessionUpdate(targetLang));
    if (!sent && isConnected && !isConnecting) {
      scheduleReconnect(targetLang);
    }
  }, [isConnected, isConnecting, scheduleReconnect, sendEvent]);

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
