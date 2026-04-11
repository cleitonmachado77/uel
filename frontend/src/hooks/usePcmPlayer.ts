'use client';

import { useCallback, useRef, useState } from 'react';

const SAMPLE_RATE = 24000;
const CHANNELS = 1;
const BUFFER_SECONDS = 0.15;

export function usePcmPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef(0);
  const stoppedRef = useRef(false);

  const ensureContext = useCallback(() => {
    if (ctxRef.current && ctxRef.current.state !== 'closed') {
      if (ctxRef.current.state === 'suspended') {
        ctxRef.current.resume().catch(() => {});
      }
      return ctxRef.current;
    }
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    ctxRef.current = ctx;
    nextStartTimeRef.current = 0;
    return ctx;
  }, []);

  const init = useCallback(async () => {
    const ctx = ensureContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    stoppedRef.current = false;
  }, [ensureContext]);

  const feedPcm = useCallback((pcmBuffer: ArrayBuffer) => {
    if (stoppedRef.current) return;

    const ctx = ensureContext();
    const int16 = new Int16Array(pcmBuffer);
    const numSamples = int16.length;
    if (numSamples === 0) return;

    const audioBuffer = ctx.createBuffer(CHANNELS, numSamples, SAMPLE_RATE);
    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < numSamples; i++) {
      channelData[i] = int16[i] / 32768;
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(nextStartTimeRef.current, now + BUFFER_SECONDS);
    source.start(startAt);
    nextStartTimeRef.current = startAt + audioBuffer.duration;

    activeSourcesRef.current += 1;
    setIsPlaying(true);

    source.onended = () => {
      activeSourcesRef.current -= 1;
      if (activeSourcesRef.current <= 0) {
        activeSourcesRef.current = 0;
        setIsPlaying(false);
      }
    };
  }, [ensureContext]);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    activeSourcesRef.current = 0;
    setIsPlaying(false);

    if (ctxRef.current && ctxRef.current.state !== 'closed') {
      ctxRef.current.close().catch(() => {});
    }
    ctxRef.current = null;
    nextStartTimeRef.current = 0;
  }, []);

  return { isPlaying, init, feedPcm, stop };
}
