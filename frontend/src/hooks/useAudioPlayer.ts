'use client';
import { useRef, useCallback, useState } from 'react';

/**
 * Player de áudio usando elemento <audio> — mais compatível com mobile
 */
export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const init = useCallback(() => {
    // Cria elemento de áudio no contexto de interação do usuário
    if (!audioRef.current) {
      const audio = new Audio();
      audio.playsInline = true;
      audio.setAttribute('playsinline', '');
      audioRef.current = audio;
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

    const blobUrl = queueRef.current.shift()!;
    const audio = audioRef.current;
    if (!audio) {
      playingRef.current = false;
      setIsPlaying(false);
      return;
    }

    audio.src = blobUrl;
    audio.onended = () => {
      URL.revokeObjectURL(blobUrl);
      playNext();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      playNext();
    };
    audio.play().catch(() => {
      // Autoplay bloqueado — tenta de novo no próximo
      URL.revokeObjectURL(blobUrl);
      playNext();
    });
  }, []);

  const enqueue = useCallback((audioData: ArrayBuffer) => {
    const blob = new Blob([audioData], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    queueRef.current.push(url);
    if (!playingRef.current) {
      playNext();
    }
  }, [playNext]);

  const stop = useCallback(() => {
    queueRef.current.forEach(URL.revokeObjectURL);
    queueRef.current = [];
    playingRef.current = false;
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
  }, []);

  return { isPlaying, enqueue, stop, init };
}
