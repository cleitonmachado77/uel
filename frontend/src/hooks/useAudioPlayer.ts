'use client';
import { useRef, useCallback, useState } from 'react';

/**
 * Player de áudio para mobile — abordagem simples e robusta.
 *
 * Cria um <audio> no DOM no init() (gesto do usuário), toca silêncio para
 * desbloquear, depois reutiliza o mesmo elemento para todos os chunks.
 */
export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const queueRef = useRef<ArrayBuffer[]>([]);
  const playingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const initDoneRef = useRef(false);

  const init = useCallback(() => {
    if (initDoneRef.current) return;

    // Cria e insere no DOM
    let audio = audioRef.current;
    if (!audio) {
      audio = document.createElement('audio');
      audio.setAttribute('playsinline', 'true');
      audio.setAttribute('webkit-playsinline', 'true');
      (audio as any).playsInline = true;
      audio.style.display = 'none';
      document.body.appendChild(audio);
      audioRef.current = audio;
    }

    // Toca silêncio MP3 mínimo para desbloquear no iOS/Android
    // Este é um MP3 válido de ~0.05s de silêncio
    const SILENCE_MP3 = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRwMHAAAAAAD/+1DEAAAH+ANoUAAABNQKbgzRQAIAAADSAAAAEBof5c/KAgCAIHygIAgfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8H/+1DEKYAAADSAMAAAAAAA0gAAAAAygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHw==';

    audio.src = SILENCE_MP3;
    audio.volume = 0.01;
    const p = audio.play();
    if (p) {
      p.then(() => {
        audio!.pause();
        audio!.volume = 1;
        audio!.currentTime = 0;
        initDoneRef.current = true;
        console.log('[AudioPlayer] Unlocked');
      }).catch((e) => {
        console.warn('[AudioPlayer] Unlock failed:', e);
        // Marca como done mesmo assim para não travar
        audio!.volume = 1;
        initDoneRef.current = true;
      });
    } else {
      initDoneRef.current = true;
    }
  }, []);

  const playNext = useCallback(() => {
    if (queueRef.current.length === 0) {
      playingRef.current = false;
      setIsPlaying(false);
      return;
    }

    playingRef.current = true;
    setIsPlaying(true);

    const audio = audioRef.current;
    if (!audio) {
      playingRef.current = false;
      setIsPlaying(false);
      return;
    }

    const audioData = queueRef.current.shift()!;
    const blob = new Blob([audioData], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);

    const cleanup = () => {
      URL.revokeObjectURL(url);
      audio.onended = null;
      audio.onerror = null;
      audio.oncanplaythrough = null;
    };

    audio.onended = () => {
      cleanup();
      playNext();
    };

    audio.onerror = () => {
      console.warn('[AudioPlayer] Error playing chunk, skipping');
      cleanup();
      playNext();
    };

    audio.src = url;

    // Espera o áudio estar pronto antes de dar play
    audio.oncanplaythrough = () => {
      audio.oncanplaythrough = null;
      audio.play().catch((err) => {
        console.warn('[AudioPlayer] play() failed:', err);
        cleanup();
        playNext();
      });
    };

    // load() força o browser a processar o novo src
    audio.load();
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
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }
  }, []);

  return { isPlaying, enqueue, stop, init };
}
