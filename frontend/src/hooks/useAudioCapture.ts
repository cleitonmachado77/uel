'use client';
import { useRef, useState, useCallback } from 'react';

function getSupportedMimeType(): string {
  // Preferência: webm/opus (melhor suporte no Deepgram), depois fallbacks
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', ''];
  for (const t of types) {
    if (t === '' || MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

/**
 * Captura de áudio com timeslice — emite chunks do mesmo stream contínuo.
 * O Deepgram Live recebe um stream WebM contínuo, não múltiplos arquivos.
 */
export function useAudioCapture(onAudioChunk: (data: Blob) => void) {
  const [isCapturing, setIsCapturing] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const mimeRef = useRef<string>('');

  const start = useCallback(async () => {
    mimeRef.current = getSupportedMimeType();
    console.log('[AudioCapture] mimeType:', mimeRef.current || '(default)');

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
    });
    streamRef.current = stream;

    const options: MediaRecorderOptions = {};
    if (mimeRef.current) options.mimeType = mimeRef.current;

    let recorder: MediaRecorder;
    try { recorder = new MediaRecorder(stream, options); }
    catch { recorder = new MediaRecorder(stream); }

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) onAudioChunk(e.data);
    };

    recorderRef.current = recorder;
    // timeslice de 250ms — chunks frequentes, stream contínuo
    recorder.start(250);
    setIsCapturing(true);
  }, [onAudioChunk]);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setIsCapturing(false);
  }, []);

  return { isCapturing, start, stop, mimeType: mimeRef.current };
}
