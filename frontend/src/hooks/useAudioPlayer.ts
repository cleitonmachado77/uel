'use client';
import { useCallback, useRef, useState } from 'react';

export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentStreamRef = useRef<MediaStream | null>(null);
  const unlockedRef = useRef(false);

  const setAudioElement = useCallback((node: HTMLAudioElement | null) => {
    audioRef.current = node;
  }, []);

  const init = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || unlockedRef.current) return;

    try {
      const silentStream = new MediaStream();
      audio.muted = true;
      audio.srcObject = silentStream;
      await audio.play();
      audio.pause();
      audio.srcObject = null;
      audio.muted = false;
      unlockedRef.current = true;
    } catch (_) {}
  }, []);

  const attachStream = useCallback(async (stream: MediaStream | null) => {
    const audio = audioRef.current;
    if (!audio) return;

    currentStreamRef.current = stream;
    audio.srcObject = stream;
    setIsPlaying(false);

    if (!stream) return;

    audio.onplaying = () => setIsPlaying(true);
    audio.onpause = () => setIsPlaying(false);
    audio.onended = () => setIsPlaying(false);
    audio.onerror = () => setIsPlaying(false);

    for (const track of stream.getAudioTracks()) {
      track.onended = () => setIsPlaying(false);
      track.onmute = () => setIsPlaying(false);
      track.onunmute = () => setIsPlaying(true);
    }

    try {
      await audio.play();
    } catch (_) {
      setIsPlaying(false);
    }
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio.onplaying = null;
      audio.onpause = null;
      audio.onended = null;
      audio.onerror = null;
    }

    currentStreamRef.current = null;
    setIsPlaying(false);
  }, []);

  return { isPlaying, init, stop, attachStream, setAudioElement };
}
