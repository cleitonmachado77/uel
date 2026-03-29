'use client';
import { useRef, useCallback, useState } from 'react';

/**
 * Player de áudio para mobile usando AudioContext.
 * 
 * init() retorna uma Promise que resolve quando o AudioContext está running.
 * Isso garante que o contexto está desbloqueado ANTES de qualquer áudio chegar.
 */
export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const queueRef = useRef<ArrayBuffer[]>([]);
  const playingRef = useRef(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  /**
   * Cria e desbloqueia o AudioContext.
   * Retorna Promise que resolve quando o contexto está running.
   * DEVE ser chamado dentro de um handler de clique/toque.
   */
  const init = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      const AC = window.AudioContext || (window as any).webkitAudioContext;

      if (!ctxRef.current) {
        const ctx = new AC();
        ctxRef.current = ctx;

        // GainNode para controle de volume
        const gain = ctx.createGain();
        gain.gain.value = 1;
        gain.connect(ctx.destination);
        gainRef.current = gain;
      }

      const ctx = ctxRef.current!;

      if (ctx.state === 'running') {
        resolve();
        return;
      }

      // Resume e espera ficar running
      ctx.resume().then(() => {
        console.log('[AudioPlayer] AudioContext state:', ctx.state);
        // Toca buffer silencioso para garantir que o output está ativo
        try {
          const osc = ctx.createOscillator();
          const silentGain = ctx.createGain();
          silentGain.gain.value = 0;
          osc.connect(silentGain);
          silentGain.connect(ctx.destination);
          osc.start(0);
          osc.stop(ctx.currentTime + 0.01);
        } catch {}
        resolve();
      }).catch(() => {
        console.warn('[AudioPlayer] resume() failed');
        resolve();
      });
    });
  }, []);

  const playNext = useCallback(() => {
    if (queueRef.current.length === 0) {
      playingRef.current = false;
      setIsPlaying(false);
      return;
    }

    const ctx = ctxRef.current;
    const gain = gainRef.current;
    if (!ctx || !gain) {
      playingRef.current = false;
      setIsPlaying(false);
      return;
    }

    // Se o contexto foi suspenso (ex: iOS background), tenta resumir
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    playingRef.current = true;
    setIsPlaying(true);

    const audioData = queueRef.current.shift()!;
    const copy = audioData.slice(0);

    ctx.decodeAudioData(copy).then((decoded) => {
      console.log('[AudioPlayer] decoded OK, duration:', decoded.duration, 's');
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      source.connect(gain);
      source.onended = () => playNext();
      source.start(0);
    }).catch((err) => {
      console.warn('[AudioPlayer] decode FAILED, size:', audioData.byteLength, 'err:', err);
      playNext();
    });
  }, []);

  const enqueue = useCallback((audioData: ArrayBuffer) => {
    console.log('[AudioPlayer] enqueue:', audioData.byteLength, 'bytes, ctx state:', ctxRef.current?.state, 'queue:', queueRef.current.length);
    queueRef.current.push(audioData);
    if (!playingRef.current) {
      playNext();
    }
  }, [playNext]);

  const stop = useCallback(() => {
    queueRef.current = [];
    playingRef.current = false;
    setIsPlaying(false);
  }, []);

  return { isPlaying, enqueue, stop, init };
}
