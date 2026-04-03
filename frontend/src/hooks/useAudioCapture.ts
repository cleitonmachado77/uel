'use client';
import { useRef, useState, useCallback } from 'react';

function getSupportedMimeType(): string {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', ''];
  for (const t of types) {
    if (t === '' || MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

/**
 * Captura de áudio em ciclos curtos de 1.5s.
 * Cada ciclo cria um novo MediaRecorder — garante WebM completo com header.
 * O Deepgram Live recebe cada chunk como um arquivo WebM válido.
 */
export function useAudioCapture(onAudioChunk: (data: Blob) => void) {
  const [isCapturing, setIsCapturing] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const activeRef = useRef(false);
  const mimeRef = useRef<string>('');
  const recorderRef = useRef<MediaRecorder | null>(null);

  const recordCycle = useCallback((stream: MediaStream) => {
    if (!activeRef.current) return;

    const options: MediaRecorderOptions = {};
    if (mimeRef.current) options.mimeType = mimeRef.current;

    let recorder: MediaRecorder;
    try { recorder = new MediaRecorder(stream, options); }
    catch { recorder = new MediaRecorder(stream); }
    recorderRef.current = recorder;

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      recorderRef.current = null;
      if (chunks.length > 0) {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size > 500) onAudioChunk(blob);
      }
      if (activeRef.current && streamRef.current) recordCycle(streamRef.current);
    };

    recorder.start();
    setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, 1500);
  }, [onAudioChunk]);

  const start = useCallback(async () => {
    mimeRef.current = getSupportedMimeType();
    console.log('[AudioCapture] mimeType:', mimeRef.current || '(default)');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
    });
    streamRef.current = stream;
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
    setIsCapturing(false);
  }, []);

  return { isCapturing, start, stop };
}
