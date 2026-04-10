'use client';
import { useRef, useState, useCallback } from 'react';

/**
 * Captura de áudio em PCM16LE (Linear16) para streaming realtime.
 * Esse formato é compatível com o Inworld Realtime API.
 */
export function useAudioCapture(onAudioChunk: (data: Blob) => void) {
  const [isCapturing, setIsCapturing] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1, sampleRate: 24000 },
    });
    streamRef.current = stream;

    const ACtx = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new ACtx({ sampleRate: 24000 });
    audioCtxRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(stream);
    sourceRef.current = source;
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const pcmBuffer = new ArrayBuffer(input.length * 2);
      const view = new DataView(pcmBuffer);
      for (let i = 0; i < input.length; i++) {
        const sample = Math.max(-1, Math.min(1, input[i]));
        view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      }
      onAudioChunk(new Blob([pcmBuffer], { type: 'application/octet-stream' }));
    };

    const mute = audioCtx.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(audioCtx.destination);
    await audioCtx.resume();
    setIsCapturing(true);
  }, [onAudioChunk]);

  const stop = useCallback(() => {
    try {
      processorRef.current?.disconnect();
      sourceRef.current?.disconnect();
      audioCtxRef.current?.close();
    } catch (_) {}
    processorRef.current = null;
    sourceRef.current = null;
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setIsCapturing(false);
  }, []);

  return { isCapturing, start, stop, mimeType: 'audio/pcm;rate=24000' };
}
