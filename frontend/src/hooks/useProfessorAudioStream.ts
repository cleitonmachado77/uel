'use client';

import { useCallback, useRef } from 'react';

const SAMPLE_RATE = 24000;

/**
 * Converts incoming PCM16LE chunks (from WebSocket) into a live MediaStream
 * that can be fed into an RTCPeerConnection as the audio input for Inworld.
 *
 * Uses AudioContext + ScriptProcessorNode + MediaStreamDestination to produce
 * a continuous MediaStream from discrete PCM buffers.
 */
export function useProfessorAudioStream() {
  const ctxRef = useRef<AudioContext | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const bufferQueueRef = useRef<Float32Array[]>([]);
  const readOffsetRef = useRef(0);

  const init = useCallback((): MediaStream => {
    cleanup();

    const ACtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new ACtx({ sampleRate: SAMPLE_RATE });
    ctxRef.current = ctx;

    const destination = ctx.createMediaStreamDestination();
    destinationRef.current = destination;

    // ScriptProcessor acts as a pull-based audio source: it reads from the queue
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (event) => {
      const output = event.outputBuffer.getChannelData(0);
      let written = 0;

      while (written < output.length && bufferQueueRef.current.length > 0) {
        const chunk = bufferQueueRef.current[0];
        const offset = readOffsetRef.current;
        const remaining = chunk.length - offset;
        const needed = output.length - written;
        const toCopy = Math.min(remaining, needed);

        output.set(chunk.subarray(offset, offset + toCopy), written);
        written += toCopy;
        readOffsetRef.current += toCopy;

        if (readOffsetRef.current >= chunk.length) {
          bufferQueueRef.current.shift();
          readOffsetRef.current = 0;
        }
      }

      // Fill remaining with silence
      if (written < output.length) {
        output.fill(0, written);
      }
    };

    processor.connect(destination);
    ctx.resume().catch(() => {});

    return destination.stream;
  }, []);

  const feedPcm = useCallback((pcmBuffer: ArrayBuffer) => {
    const int16 = new Int16Array(pcmBuffer);
    if (int16.length === 0) return;

    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }
    bufferQueueRef.current.push(float32);

    // Prevent unbounded memory growth (keep max ~5 seconds of audio)
    const maxChunks = Math.ceil((SAMPLE_RATE * 5) / 4096);
    while (bufferQueueRef.current.length > maxChunks) {
      bufferQueueRef.current.shift();
      readOffsetRef.current = 0;
    }
  }, []);

  function cleanup() {
    try {
      processorRef.current?.disconnect();
      ctxRef.current?.close();
    } catch (_) {}
    processorRef.current = null;
    destinationRef.current = null;
    ctxRef.current = null;
    bufferQueueRef.current = [];
    readOffsetRef.current = 0;
  }

  const stop = useCallback(() => {
    cleanup();
  }, []);

  return { init, feedPcm, stop };
}
