'use client';
import { useRef, useCallback, useState } from 'react';

/**
 * Player de áudio para mobile e desktop.
 *
 * Estratégia:
 * - HTMLAudioElement para reprodução (suporte universal a MP3, inclusive iOS Safari)
 * - AudioContext apenas para desbloquear o autoplay no gesto do usuário
 * - Fila sequencial: cada chunk toca assim que o anterior termina, sem gap perceptível
 */
export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<ArrayBuffer[]>([]);
  const playingRef = useRef(false);
  const unlockedRef = useRef(false);
  const currentUrlRef = useRef<string | null>(null);

  const getAudio = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      const a = document.createElement('audio');
      a.setAttribute('playsinline', 'true');
      a.setAttribute('webkit-playsinline', 'true');
      (a as any).playsInline = true;
      a.preload = 'auto';
      a.style.display = 'none';
      document.body.appendChild(a);
      audioRef.current = a;
    }
    return audioRef.current;
  }, []);

  // Desbloqueia autoplay tocando 1 frame de silêncio dentro do gesto do usuário
  const init = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      if (unlockedRef.current) { resolve(); return; }

      // Tenta desbloquear via AudioContext (mais confiável em iOS)
      try {
        const ACtx = window.AudioContext || (window as any).webkitAudioContext;
        if (ACtx) {
          const ctx = new ACtx();
          const buf = ctx.createBuffer(1, 1, 22050);
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(ctx.destination);
          src.start(0);
          ctx.resume().then(() => {
            ctx.close();
          }).catch(() => {});
        }
      } catch (_) {}

      // Desbloqueia HTMLAudioElement com silêncio MP3
      const audio = getAudio();
      const SILENCE = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRwMHAAAAAAD/+1DEAAAH+ANoUAAABNQKbgzRQAIAAADSAAAAEBof5c/KAgCAIHygIAgfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8H/+1DEKYAAADSAMAAAAAAA0gAAAAAygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHw==';
      audio.src = SILENCE;
      audio.volume = 1;
      const p = audio.play();
      if (p) {
        p.then(() => {
          unlockedRef.current = true;
          console.log('[AudioPlayer] unlocked');
          resolve();
        }).catch(() => {
          // Mesmo falhando, marca como desbloqueado para tentar reproduzir
          unlockedRef.current = true;
          resolve();
        });
      } else {
        unlockedRef.current = true;
        resolve();
      }
    });
  }, [getAudio]);

  const playNext = useCallback(() => {
    if (queueRef.current.length === 0) {
      playingRef.current = false;
      setIsPlaying(false);
      return;
    }

    const audio = getAudio();
    playingRef.current = true;
    setIsPlaying(true);

    // Revoga URL anterior
    if (currentUrlRef.current) {
      URL.revokeObjectURL(currentUrlRef.current);
      currentUrlRef.current = null;
    }

    const audioData = queueRef.current.shift()!;
    const blob = new Blob([audioData], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    currentUrlRef.current = url;

    audio.onended = () => {
      URL.revokeObjectURL(url);
      currentUrlRef.current = null;
      playNext();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      currentUrlRef.current = null;
      playNext();
    };

    audio.src = url;
    audio.load();
    audio.play().catch((err) => {
      console.warn('[AudioPlayer] play() rejected:', err);
      URL.revokeObjectURL(url);
      currentUrlRef.current = null;
      playNext();
    });
  }, [getAudio]);

  const enqueue = useCallback((audioData: ArrayBuffer) => {
    queueRef.current.push(audioData);
    if (!playingRef.current) playNext();
  }, [playNext]);

  const stop = useCallback(() => {
    queueRef.current = [];
    playingRef.current = false;
    setIsPlaying(false);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = '';
    }
    if (currentUrlRef.current) {
      URL.revokeObjectURL(currentUrlRef.current);
      currentUrlRef.current = null;
    }
  }, []);

  return { isPlaying, enqueue, stop, init };
}
