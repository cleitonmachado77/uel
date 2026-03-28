'use client';
import { useRef, useState, useCallback } from 'react';

export function useAudioCapture(onAudioChunk: (data: Blob) => void) {
  const [isCapturing, setIsCapturing] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Mede volume RMS do áudio atual
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
    const recorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus',
    });
    const chunks: Blob[] = [];
    let peakVolume = 0;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
      const vol = getVolume();
      if (vol > peakVolume) peakVolume = vol;
    };

    recorder.onstop = () => {
      // Só envia se o pico de volume indicar fala real (threshold 0.02)
      if (chunks.length > 0 && peakVolume > 0.02) {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        onAudioChunk(blob);
      }
    };

    recorder.start(250); // Checa volume a cada 250ms
    setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, 2000);
  }, [onAudioChunk, getVolume]);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
    });
    streamRef.current = stream;

    const audioCtx = new AudioContext();
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
