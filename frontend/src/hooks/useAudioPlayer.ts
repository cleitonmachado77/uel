'use client';
import { useRef, useCallback, useState } from 'react';

export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const queueRef = useRef<ArrayBuffer[]>([]);
  const playingRef = useRef(false);

  const init = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
  }, []);

  const enqueue = useCallback((audioData: ArrayBuffer) => {
    init();
    queueRef.current.push(audioData);
    if (!playingRef.current) {
      playNext();
    }
  }, [init]);

  const playNext = useCallback(async () => {
    const ctx = audioContextRef.current;
    if (!ctx || queueRef.current.length === 0) {
      playingRef.current = false;
      setIsPlaying(false);
      return;
    }

    playingRef.current = true;
    setIsPlaying(true);

    const data = queueRef.current.shift()!;
    try {
      const audioBuffer = await ctx.decodeAudioData(data.slice(0));
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => playNext();
      source.start();
    } catch {
      // Se falhar a decodificação, tenta o próximo
      playNext();
    }
  }, []);

  const stop = useCallback(() => {
    queueRef.current = [];
    playingRef.current = false;
    setIsPlaying(false);
    audioContextRef.current?.close();
    audioContextRef.current = null;
  }, []);

  return { isPlaying, enqueue, stop, init };
}
