'use client';
import { useRef, useState, useCallback } from 'react';

/**
 * Captura de áudio com compatibilidade mobile.
 * - Detecta mimeType suportado (webm/opus não funciona no iOS Safari)
 * - Resume AudioContext suspenso (política mobile)
 * - Usa um único MediaRecorder contínuo com timeslice para evitar sobreposição
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
  const recorderRef = useRef<MediaRecorder | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const flushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const start = useCallback(async () => {
    const mimeType = getSupportedMimeType();
    console.log('[AudioCapture] Using mimeType:', mimeType || '(default)');

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
    });
    streamRef.current = stream;

    // AudioContext para análise de volume
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;

    // Um único MediaRecorder contínuo — coleta dados via timeslice
    const options: MediaRecorderOptions = {};
    if (mimeType) options.mimeType = mimeType;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, options);
    } catch {
      recorder = new MediaRecorder(stream);
    }
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    // Inicia gravação contínua com timeslice de 500ms
    recorder.start(500);

    // Flush a cada 3s: junta os chunks acumulados e envia se tiver volume
    flushIntervalRef.current = setInterval(() => {
      const chunks = chunksRef.current;
      chunksRef.current = [];

      if (chunks.length === 0) return;

      const vol = getVolume();
      if (vol < 0.04) return; // Silêncio — descarta

      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size < 2000) return; // Muito pequeno

      onAudioChunk(blob);
    }, 3000);

    setIsCapturing(true);
  }, [onAudioChunk, getVolume]);

  const stop = useCallback(() => {
    if (flushIntervalRef.current) {
      clearInterval(flushIntervalRef.current);
      flushIntervalRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    chunksRef.current = [];
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    setIsCapturing(false);
  }, []);

  return { isCapturing, start, stop };
}
