'use client';
import { useRef, useCallback, useState } from 'react';

/**
 * Player de áudio para mobile usando Web Audio API (AudioContext + decodeAudioData).
 *
 * Por que não usar <audio> element:
 * - iOS Safari bloqueia .play() em <audio> fora de gesto do usuário, MESMO após unlock
 * - Trocar .src e chamar .play() assincronamente (via WebSocket) é tratado como novo autoplay
 * - Web Audio API, uma vez desbloqueada com resume() no gesto, permite playback livre via código
 */
export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const queueRef = useRef<ArrayBuffer[]>([]);
  const playingRef = useRef(false);
  const ctxRef = useRef<AudioContext | null>(null);

  /**
   * DEVE ser chamado dentro de um handler de clique/toque do usuário.
   * Cria e desbloqueia o AudioContext.
   */
  const init = useCallback(() => {
    if (!ctxRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      ctxRef.current = new AudioCtx();
    }

    const ctx = ctxRef.current;

    // Resume é obrigatório no gesto do usuário para iOS/Android
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => {
        console.log('[AudioPlayer] AudioContext resumed');
      }).catch(() => {});
    }

    // Toca um buffer vazio para garantir que o contexto está realmente ativo no iOS
    if (ctx.state === 'running' || ctx.state === 'suspended') {
      try {
        const silentBuffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        const source = ctx.createBufferSource();
        source.buffer = silentBuffer;
        source.connect(ctx.destination);
        source.start(0);
      } catch {
        // ignora
      }
    }
  }, []);

  const playNext = useCallback(() => {
    if (queueRef.current.length === 0) {
      playingRef.current = false;
      setIsPlaying(false);
      return;
    }

    const ctx = ctxRef.current;
    if (!ctx) {
      playingRef.current = false;
      setIsPlaying(false);
      return;
    }

    // Garante que o contexto está ativo
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    playingRef.current = true;
    setIsPlaying(true);

    const audioData = queueRef.current.shift()!;

    // decodeAudioData precisa de uma cópia do buffer (ele "consome" o ArrayBuffer)
    const copy = audioData.slice(0);

    ctx.decodeAudioData(
      copy,
      (decodedBuffer) => {
        const source = ctx.createBufferSource();
        source.buffer = decodedBuffer;
        source.connect(ctx.destination);
        source.onended = () => {
          playNext();
        };
        source.start(0);
      },
      (err) => {
        console.warn('[AudioPlayer] decodeAudioData failed:', err);
        // Se falhar decode, tenta fallback com <audio> element
        playWithFallback(audioData).then(() => playNext()).catch(() => playNext());
      }
    );
  }, []);

  /**
   * Fallback: usa <audio> element para formatos que o AudioContext não decodifica.
   */
  const playWithFallback = useCallback((audioData: ArrayBuffer): Promise<void> => {
    return new Promise((resolve) => {
      try {
        const blob = new Blob([audioData], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio();
        audio.setAttribute('playsinline', 'true');
        audio.src = url;
        audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
        audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        audio.play().catch(() => { URL.revokeObjectURL(url); resolve(); });
      } catch {
        resolve();
      }
    });
  }, []);

  const enqueue = useCallback((audioData: ArrayBuffer) => {
    queueRef.current.push(audioData);
    if (!playingRef.current) {
      playNext();
    }
  }, [playNext]);

  const stop = useCallback(() => {
    queueRef.current = [];
    playingRef.current = false;
    setIsPlaying(false);
    // Não fecha o AudioContext — ele será reutilizado
  }, []);

  return { isPlaying, enqueue, stop, init };
}
