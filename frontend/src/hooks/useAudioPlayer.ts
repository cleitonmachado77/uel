'use client';
import { useRef, useCallback, useState } from 'react';

export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const queueRef = useRef<ArrayBuffer[]>([]);
  const playingRef = useRef(false);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const getContext = useCallback(() => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    // Resume se estiver suspenso (mobile requer isso)
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  // Deve ser chamado em resposta a um toque do usuário
  const init = useCallback(() => {
    const ctx = getContext();
    // Toca um buffer vazio pra desbloquear o áudio no mobile
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  }, [getContext]);

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
      // Resume antes de decodificar (mobile)
      if (ctx.state === 'suspended') await ctx.resume();
      
      const audioBuffer = await ctx.decodeAudioData(data.slice(0));
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      sourceRef.current = source;
      source.onended = () => {
        sourceRef.current = null;
        playNext();
      };
      source.start();
    } catch {
      // Se falhar a decodificação, tenta o próximo
      playNext();
    }
  }, []);

  const enqueue = useCallback((audioData: ArrayBuffer) => {
    // Garante que o contexto existe
    getContext();
    queueRef.current.push(audioData);
    if (!playingRef.current) {
      playNext();
    }
  }, [getContext, playNext]);

  const stop = useCallback(() => {
    queueRef.current = [];
    playingRef.current = false;
    setIsPlaying(false);
    sourceRef.current?.stop();
    sourceRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
  }, []);

  return { isPlaying, enqueue, stop, init };
}
