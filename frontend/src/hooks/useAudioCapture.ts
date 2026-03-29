'use client';
import { useRef, useState, useCallback } from 'react';

/**
 * Captura de áudio com compatibilidade mobile.
 * - Detecta mimeType suportado (webm/opus não funciona no iOS Safari)
 * - Resume AudioContext suspenso (política mobile)
 */

function getSupportedMimeType(): string {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/aac',
    'audio/ogg;codecs=opus',
    '',
  ];
  for (const t of types) {
    if (t === '' || MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

export function useAudioCapture(onAudioChunk: (data: Blob) => void) {
  const [isCapturing, setIsCapturing] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mimeRef = useRef<string>('');

  const getVolume = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return 0;
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }
    return Math.sqrt(sum / data.length);
  }, []);

  const startRecording = useCallback((stream: MediaStream) => {
    const options: MediaRecorderOptions = {};
    if (mimeRef.current) options.mimeType = mimeRef.current;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, options);
    } catch {
      // Fallback sem mimeType específico
      recorder = new MediaRecorder(stream);
    }

    const chunks: Blob[] = [];
    let peakVolume = 0;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
      const vol = getVolume();
      if (vol > peakVolume) peakVolume = vol;
    };

    recorder.onstop = () => {
      if (chunks.length > 0 && peakVolume > 0.02) {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        onAudioChunk(blob);
      }
    };

    recorder.start(250);
    setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, 2000);
  }, [onAudioChunk, getVolume]);

  const start = useCallback(async () => {
    // Detecta mimeType suportado uma vez
    mimeRef.current = getSupportedMimeType();
    console.log('[AudioCapture] Using mimeType:', mimeRef.current || '(default)');

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
    });
    streamRef.current = stream;

    // Usa webkitAudioContext como fallback (iOS Safari antigo)
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioCtx();

    // Resume contexto suspenso (política mobile)
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;

    setIsCapturing(true);
    startRecording(stream);
    intervalRef.current = setInterval(() => {
      if (streamRef.current) startRecording(streamRef.current);
    }, 2000);
  }, [startRecording]);

  const stop = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    setIsCapturing(false);
  }, []);

  return { isCapturing, start, stop };
}
