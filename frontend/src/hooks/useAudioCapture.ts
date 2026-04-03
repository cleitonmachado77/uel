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
 * Captura de áudio em modo streaming contínuo.
 *
 * O Deepgram Live aceita WebM parcial — o header só existe no primeiro chunk,
 * mas o Deepgram mantém o contexto da conexão e decodifica os chunks subsequentes.
 * timeslice=500ms: latência de captura ~500ms vs ~3000ms anterior.
 */
export function useAudioCapture(onAudioChunk: (data: Blob) => void) {
  const [isCapturing, setIsCapturing] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const activeRef = useRef(false);
  const mimeRef = useRef<string>('');

  const start = useCallback(async () => {
    mimeRef.current = getSupportedMimeType();
    console.log('[AudioCapture] mimeType:', mimeRef.current || '(default)');

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
    });
    streamRef.current = stream;
    activeRef.current = true;
    setIsCapturing(true);

    const options: MediaRecorderOptions = {};
    if (mimeRef.current) options.mimeType = mimeRef.current;

    let recorder: MediaRecorder;
    try { recorder = new MediaRecorder(stream, options); }
    catch { recorder = new MediaRecorder(stream); }
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0 && activeRef.current) {
        onAudioChunk(e.data);
      }
    };

    // 500ms timeslice: cada chunk é enviado ao Deepgram stream continuamente
    // O Deepgram mantém contexto da conexão WS e processa chunks parciais de WebM
    recorder.start(500);
    console.log('[AudioCapture] streaming started, timeslice=500ms');
  }, [onAudioChunk]);

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
