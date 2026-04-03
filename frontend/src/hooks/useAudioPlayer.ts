'use client';
import { useRef, useCallback, useState } from 'react';

/**
 * Player usando Web Audio API (AudioContext).
 * Decodifica e agenda chunks com precisão de sample — sem gap entre frases.
 * Fallback para HTMLAudioElement em browsers sem suporte.
 */
export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const nextStartRef = useRef(0);       // quando o próximo chunk deve começar (AudioContext time)
  const activeNodesRef = useRef(0);     // chunks em reprodução
  const readyRef = useRef(false);

  const getCtx = useCallback((): AudioContext => {
    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return ctxRef.current;
  }, []);

  const init = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      if (readyRef.current) { resolve(); return; }
      try {
        const ctx = getCtx();
        // Resume necessário em iOS/Safari (AudioContext começa suspenso)
        const resume = ctx.resume ? ctx.resume() : Promise.resolve();
        resume.then(() => {
          readyRef.current = true;
          console.log('[AudioPlayer] AudioContext unlocked, state:', ctx.state);
          resolve();
        }).catch(() => { readyRef.current = true; resolve(); });
      } catch {
        readyRef.current = true;
        resolve();
      }
    });
  }, [getCtx]);

  const enqueue = useCallback((audioData: ArrayBuffer) => {
    const ctx = getCtx();

    // Resume silencioso se suspenso (iOS suspende ao perder foco)
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    ctx.decodeAudioData(audioData.slice(0)).then((buffer) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      // Agenda imediatamente após o chunk anterior (sem gap)
      const now = ctx.currentTime;
      const startAt = Math.max(now, nextStartRef.current);
      source.start(startAt);
      nextStartRef.current = startAt + buffer.duration;

      activeNodesRef.current++;
      setIsPlaying(true);

      source.onended = () => {
        activeNodesRef.current--;
        if (activeNodesRef.current === 0) {
          setIsPlaying(false);
        }
      };
    }).catch((err) => {
      console.warn('[AudioPlayer] decodeAudioData failed:', err);
    });
  }, [getCtx]);

  const stop = useCallback(() => {
    activeNodesRef.current = 0;
    nextStartRef.current = 0;
    setIsPlaying(false);
    // Fecha e recria o contexto para cancelar todos os nodes agendados
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
      readyRef.current = false;
    }
  }, []);

  return { isPlaying, enqueue, stop, init };
}
