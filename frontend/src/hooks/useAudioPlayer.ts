'use client';
import { useRef, useCallback, useState } from 'react';

/**
 * Player de áudio para mobile.
 * 
 * Usa <audio> element para reprodução (categoria "playback" no iOS, ignora silent switch).
 * Usa AudioContext apenas para unlock/warm-up no gesto do usuário.
 * 
 * O truque: criar um <audio> element, dar play() no gesto do usuário com um MP3 silencioso,
 * e depois reutilizar o MESMO elemento para todos os chunks via blob URL.
 * No iOS, o elemento fica "quente" após o primeiro play() no gesto.
 */
export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const queueRef = useRef<ArrayBuffer[]>([]);
  const playingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const readyRef = useRef(false);

  const init = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      if (readyRef.current) { resolve(); return; }

      // Cria elemento e insere no DOM
      if (!audioRef.current) {
        const a = document.createElement('audio');
        a.setAttribute('playsinline', 'true');
        a.setAttribute('webkit-playsinline', 'true');
        (a as any).playsInline = true;
        a.style.display = 'none';
        document.body.appendChild(a);
        audioRef.current = a;
      }

      const audio = audioRef.current;

      // MP3 silencioso válido (~0.05s) para desbloquear
      const SILENCE = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRwMHAAAAAAD/+1DEAAAH+ANoUAAABNQKbgzRQAIAAADSAAAAEBof5c/KAgCAIHygIAgfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8H/+1DEKYAAADSAMAAAAAAA0gAAAAAygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHw==';

      audio.src = SILENCE;
      audio.volume = 1;

      const p = audio.play();
      if (p) {
        p.then(() => {
          readyRef.current = true;
          console.log('[AudioPlayer] <audio> unlocked via play()');
          resolve();
        }).catch((e) => {
          console.warn('[AudioPlayer] unlock failed:', e);
          readyRef.current = true; // tenta mesmo assim
          resolve();
        });
      } else {
        readyRef.current = true;
        resolve();
      }
    });
  }, []);

  const playNext = useCallback(() => {
    if (queueRef.current.length === 0) {
      playingRef.current = false;
      setIsPlaying(false);
      return;
    }

    const audio = audioRef.current;
    if (!audio) {
      playingRef.current = false;
      setIsPlaying(false);
      return;
    }

    playingRef.current = true;
    setIsPlaying(true);

    const audioData = queueRef.current.shift()!;
    const blob = new Blob([audioData], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);

    // Limpa handlers anteriores
    audio.onended = null;
    audio.onerror = null;

    audio.onended = () => {
      URL.revokeObjectURL(url);
      playNext();
    };

    audio.onerror = () => {
      console.warn('[AudioPlayer] playback error');
      URL.revokeObjectURL(url);
      playNext();
    };

    audio.src = url;
    audio.load();

    // Usa evento canplay para saber quando está pronto
    const tryPlay = () => {
      audio.play().then(() => {
        console.log('[AudioPlayer] playing chunk,', audioData.byteLength, 'bytes');
      }).catch((err) => {
        console.warn('[AudioPlayer] play() rejected:', err);
        URL.revokeObjectURL(url);
        playNext();
      });
    };

    // Se readyState >= 2 (HAVE_CURRENT_DATA), pode tocar direto
    if (audio.readyState >= 2) {
      tryPlay();
    } else {
      audio.oncanplay = () => {
        audio.oncanplay = null;
        tryPlay();
      };
    }
  }, []);

  const enqueue = useCallback((audioData: ArrayBuffer) => {
    console.log('[AudioPlayer] enqueue:', audioData.byteLength, 'bytes, queue:', queueRef.current.length);
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
    }
  }, []);

  return { isPlaying, enqueue, stop, init };
}
