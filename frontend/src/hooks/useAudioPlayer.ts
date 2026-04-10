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
  const queueRef = useRef<Array<{ data: ArrayBuffer; meta?: Record<string, unknown> }>>([]);
  const playingRef = useRef(false);
  const unlockedRef = useRef(false);
  const currentUrlRef = useRef<string | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nextStartRef = useRef(0);

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
          const ctx = ctxRef.current || new ACtx();
          ctxRef.current = ctx;
          const buf = ctx.createBuffer(1, 1, 22050);
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(ctx.destination);
          src.start(0);
          ctx.resume().catch(() => {});
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

  const playPcmChunk = useCallback((audioData: ArrayBuffer, sampleRate: number) => {
    const ACtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!ACtx) return false;

    const ctx = ctxRef.current || new ACtx();
    ctxRef.current = ctx;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const int16 = new Int16Array(audioData);
    if (int16.length === 0) return true;
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const buffer = ctx.createBuffer(1, float32.length, sampleRate);
    buffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const startAt = Math.max(ctx.currentTime + 0.01, nextStartRef.current);
    source.start(startAt);
    nextStartRef.current = startAt + buffer.duration;
    source.onended = () => {
      if (queueRef.current.length === 0 && ctx.currentTime >= nextStartRef.current - 0.02) {
        playingRef.current = false;
        setIsPlaying(false);
      }
    };

    return true;
  }, []);

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

    const item = queueRef.current.shift()!;
    const codec = (item.meta?.codec as string | undefined)?.toLowerCase();
    const sampleRate = Number(item.meta?.sampleRate) || 24000;
    if (codec === 'pcm16le' || codec === 'linear16' || codec === 'pcm16') {
      const played = playPcmChunk(item.data, sampleRate);
      if (played) {
        if (queueRef.current.length > 0) playNext();
        return;
      }
    }

    const blob = new Blob([item.data], { type: 'audio/mpeg' });
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
  }, [getAudio, playPcmChunk]);

  const enqueue = useCallback((audioData: ArrayBuffer, meta?: Record<string, unknown>) => {
    queueRef.current.push({ data: audioData, meta });

    const codec = (meta?.codec as string | undefined)?.toLowerCase();
    const isPcm = codec === 'pcm16le' || codec === 'linear16' || codec === 'pcm16';

    // Para PCM em streaming, precisamos continuar agendando mesmo já "tocando".
    // Para MP3 legada, mantemos fluxo sequencial via onended.
    if (isPcm || !playingRef.current) {
      playNext();
    }
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
    nextStartRef.current = 0;
  }, []);

  return { isPlaying, enqueue, stop, init };
}
