'use client';
import { useRef, useCallback, useState } from 'react';

function detectMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent)) return true;
  if (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1) return true;
  return false;
}

/**
 * Player de áudio para mobile e desktop.
 *
 * - Desktop: AudioContext com BufferSource agendados (gapless)
 * - Mobile/iPad: HTMLAudioElement puro com WAV blobs (compatibilidade iOS)
 */
export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<Array<{ data: ArrayBuffer; meta?: Record<string, unknown> }>>([]);
  const playingRef = useRef(false);
  const unlockedRef = useRef(false);
  const currentUrlRef = useRef<string | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nextStartRef = useRef(0);
  const pcmBatchRef = useRef<Uint8Array[]>([]);
  const pcmBatchBytesRef = useRef(0);
  const pcmBatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryPlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mobilePrimedRef = useRef(false);

  const isMobile = detectMobile();

  const PCM_BATCH_BYTES = isMobile ? 19200 : 9600;  // ~400ms vs ~200ms @ 24kHz mono 16-bit
  const PCM_FLUSH_MS = isMobile ? 250 : 120;

  const SILENCE_MP3 = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRwMHAAAAAAD/+1DEAAAH+ANoUAAABNQKbgzRQAIAAADSAAAAEBof5c/KAgCAIHygIAgfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8H/+1DEKYAAADSAMAAAAAAA0gAAAAAygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHw==';

  const getAudio = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      const a = document.createElement('audio');
      a.setAttribute('playsinline', 'true');
      a.setAttribute('webkit-playsinline', 'true');
      (a as any).playsInline = true;
      a.preload = 'auto';
      document.body.appendChild(a);
      audioRef.current = a;
    }
    return audioRef.current;
  }, []);

  const init = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      if (unlockedRef.current) { resolve(); return; }

      // Desktop: AudioContext unlock
      if (!isMobile) {
        try {
          const ACtx = window.AudioContext || (window as any).webkitAudioContext;
          if (ACtx) {
            const ctx = ctxRef.current || new ACtx();
            ctxRef.current = ctx;
            const buf = ctx.createBuffer(1, 1, 22050);
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(ctx.destination);
            src.start(0);
            ctx.resume().catch(() => {});
          }
        } catch (_) {}
      }

      // HTMLAudioElement unlock (mobile + desktop)
      const audio = getAudio();
      audio.src = SILENCE_MP3;
      audio.volume = 1;
      const p = audio.play();
      if (p) {
        p.then(() => {
          unlockedRef.current = true;
          console.log('[AudioPlayer] unlocked (mobile:', isMobile, ')');
          resolve();
        }).catch(() => {
          unlockedRef.current = false;
          resolve();
        });
      } else {
        unlockedRef.current = false;
        resolve();
      }
    });
  }, [getAudio, isMobile]);

  const pcm16ToWav = useCallback((audioData: ArrayBuffer, sampleRate: number): Blob => {
    const pcmData = new Uint8Array(audioData);
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);
    const byteRate = sampleRate * 2;
    const dataSize = pcmData.byteLength;

    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + dataSize, true);
    view.setUint32(8, 0x57415645, false); // "WAVE"
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataSize, true);

    return new Blob([wavHeader, pcmData], { type: 'audio/wav' });
  }, []);

  const concatUint8 = useCallback((chunks: Uint8Array[]): ArrayBuffer => {
    const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged.buffer;
  }, []);

  // Desktop: AudioContext gapless scheduling
  const playPcmViaContext = useCallback((audioData: ArrayBuffer, sampleRate: number): boolean => {
    const ACtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!ACtx) return false;

    const ctx = ctxRef.current || new ACtx();
    ctxRef.current = ctx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (ctx.state !== 'running') return false;

    const int16 = new Int16Array(audioData);
    if (int16.length === 0) return true;
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const buffer = ctx.createBuffer(1, float32.length, sampleRate);
    buffer.copyToChannel(float32, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const startAt = Math.max(ctx.currentTime + 0.01, nextStartRef.current);
    source.start(startAt);
    nextStartRef.current = startAt + buffer.duration;
    source.onended = () => {
      if (queueRef.current.length === 0 && ctx.currentTime >= nextStartRef.current - 0.02) {
        playingRef.current = false;
        setIsPlaying(false);
      }
    };
    return true;
  }, []);

  // Mobile + fallback: WAV via HTMLAudioElement
  const playViaElement = useCallback((item: { data: ArrayBuffer; meta?: Record<string, unknown> }, sampleRate: number) => {
    const audio = getAudio();
    const wavBlob = pcm16ToWav(item.data, sampleRate);
    const wavUrl = URL.createObjectURL(wavBlob);
    currentUrlRef.current = wavUrl;

    const cleanup = () => {
      URL.revokeObjectURL(wavUrl);
      if (currentUrlRef.current === wavUrl) currentUrlRef.current = null;
    };

    audio.onended = () => { cleanup(); playNext(); };
    audio.onerror = () => { cleanup(); playNext(); };
    audio.src = wavUrl;
    audio.load();
    audio.play().catch(() => {
      cleanup();
      queueRef.current.unshift(item);
      playingRef.current = false;
      setIsPlaying(false);
      if (!retryPlayTimerRef.current) {
        retryPlayTimerRef.current = setTimeout(() => {
          retryPlayTimerRef.current = null;
          if (queueRef.current.length > 0 && !playingRef.current) {
            playNext();
          }
        }, 300);
      }
    });
  }, [getAudio, pcm16ToWav]);

  const playNext = useCallback(() => {
    if (queueRef.current.length === 0) {
      playingRef.current = false;
      setIsPlaying(false);
      return;
    }

    playingRef.current = true;
    setIsPlaying(true);

    if (currentUrlRef.current) {
      URL.revokeObjectURL(currentUrlRef.current);
      currentUrlRef.current = null;
    }

    const item = queueRef.current.shift()!;
    const codec = (item.meta?.codec as string | undefined)?.toLowerCase();
    const sampleRate = Number(item.meta?.sampleRate) || 24000;
    const isPcm = codec === 'pcm16le' || codec === 'linear16' || codec === 'pcm16';

    if (isPcm) {
      // Desktop: AudioContext gapless
      if (!isMobile) {
        const ctx = ctxRef.current;
        if (ctx?.state === 'running') {
          const played = playPcmViaContext(item.data, sampleRate);
          if (played) {
            if (queueRef.current.length > 0) playNext();
            return;
          }
        }
      }

      // Mobile (primary) / Desktop (fallback): WAV via HTMLAudioElement
      playViaElement(item, sampleRate);
      return;
    }

    // MP3
    const audio = getAudio();
    const blob = new Blob([item.data], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    currentUrlRef.current = url;

    audio.onended = () => { URL.revokeObjectURL(url); currentUrlRef.current = null; playNext(); };
    audio.onerror = () => { URL.revokeObjectURL(url); currentUrlRef.current = null; playNext(); };
    audio.src = url;
    audio.load();
    audio.play().catch(() => {
      URL.revokeObjectURL(url);
      currentUrlRef.current = null;
      queueRef.current.unshift(item);
      playingRef.current = false;
      setIsPlaying(false);
      if (!retryPlayTimerRef.current) {
        retryPlayTimerRef.current = setTimeout(() => {
          retryPlayTimerRef.current = null;
          if (queueRef.current.length > 0 && !playingRef.current) playNext();
        }, 300);
      }
    });
  }, [getAudio, isMobile, playPcmViaContext, playViaElement]);

  const enqueue = useCallback((audioData: ArrayBuffer, meta?: Record<string, unknown>) => {
    const codec = (meta?.codec as string | undefined)?.toLowerCase();
    const isPcm = codec === 'pcm16le' || codec === 'linear16' || codec === 'pcm16';
    const sampleRate = Number(meta?.sampleRate) || 24000;

    if (isMobile && isPcm) {
      const bytes = new Uint8Array(audioData);
      pcmBatchRef.current.push(bytes);
      pcmBatchBytesRef.current += bytes.byteLength;

      const flushBatch = () => {
        if (pcmBatchRef.current.length === 0) return;
        const merged = concatUint8(pcmBatchRef.current);
        pcmBatchRef.current = [];
        pcmBatchBytesRef.current = 0;
        queueRef.current.push({
          data: merged,
          meta: { ...(meta || {}), codec: 'pcm16le', sampleRate },
        });
        if (playingRef.current) return;
        if (!mobilePrimedRef.current) {
          if (queueRef.current.length < 1) return;
          mobilePrimedRef.current = true;
        }
        playNext();
      };

      if (pcmBatchBytesRef.current >= PCM_BATCH_BYTES) {
        if (pcmBatchTimerRef.current) { clearTimeout(pcmBatchTimerRef.current); pcmBatchTimerRef.current = null; }
        flushBatch();
      } else if (!pcmBatchTimerRef.current) {
        pcmBatchTimerRef.current = setTimeout(() => { pcmBatchTimerRef.current = null; flushBatch(); }, PCM_FLUSH_MS);
      }
      return;
    }

    queueRef.current.push({ data: audioData, meta });
    if (isPcm || !playingRef.current) playNext();
  }, [concatUint8, isMobile, playNext, PCM_BATCH_BYTES, PCM_FLUSH_MS]);

  const stop = useCallback(() => {
    queueRef.current = [];
    pcmBatchRef.current = [];
    pcmBatchBytesRef.current = 0;
    mobilePrimedRef.current = false;
    if (pcmBatchTimerRef.current) { clearTimeout(pcmBatchTimerRef.current); pcmBatchTimerRef.current = null; }
    if (retryPlayTimerRef.current) { clearTimeout(retryPlayTimerRef.current); retryPlayTimerRef.current = null; }
    playingRef.current = false;
    setIsPlaying(false);
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.src = ''; }
    if (currentUrlRef.current) { URL.revokeObjectURL(currentUrlRef.current); currentUrlRef.current = null; }
    nextStartRef.current = 0;
  }, []);

  return { isPlaying, enqueue, stop, init };
}
