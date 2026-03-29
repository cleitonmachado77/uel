'use client';
import { useRef, useState, useCallback } from 'react';

/**
 * Captura de áudio com compatibilidade mobile.
 * - Detecta mimeType suportado (webm/opus não funciona no iOS Safari)
 * - Resume AudioContext suspenso (política mobile)
 * - Um recorder por ciclo (cada um gera WebM completo com header)
 * - Sem sobreposição: o próximo só inicia após o anterior parar
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
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mimeRef = useRef<string>('');
  const activeRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);

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

  /** Grava um ciclo de ~3s e envia se tiver volume. Chama a si mesmo em loop. */
  const recordCycle = useCallback((stream: MediaStream) => {
    if (!activeRef.current) return;

    const options: MediaRecorderOptions = {};
    if (mimeRef.current) options.mimeType = mimeRef.current;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, options);
    } catch {
      recorder = new MediaRecorder(stream);
    }
    recorderRef.current = recorder;

    const chunks: Blob[] = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      recorderRef.current = null;
      const vol = getVolume();
      if (chunks.length > 0 && vol > 0.04) {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size > 2000) {
          onAudioChunk(blob);
        }
      }
      // Inicia o próximo ciclo (sem sobreposição)
      if (activeRef.current && streamRef.current) {
        recordCycle(streamRef.current);
      }
    };

    recorder.start();
    setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, 3000);
  }, [onAudioChunk, getVolume]);

  const start = useCallback(async () => {
    mimeRef.current = getSupportedMimeType();
    console.log('[AudioCapture] Using mimeType:', mimeRef.current || '(default)');

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
    });
    streamRef.current = stream;

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;

    activeRef.current = true;
    setIsCapturing(true);
    recordCycle(stream);
  }, [recordCycle]);

  const stop = useCallback(() => {
    activeRef.current = false;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    setIsCapturing(false);
  }, []);

  return { isCapturing, start, stop };
}
