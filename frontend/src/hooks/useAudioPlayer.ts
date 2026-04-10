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
 * - Mobile/iPad: Double-buffer HTMLAudioElement — dois elementos alternados
 *   para eliminar gap entre plays (próximo WAV pré-carregado enquanto o atual toca)
 */
export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);

  const audioRefA = useRef<HTMLAudioElement | null>(null);
  const audioRefB = useRef<HTMLAudioElement | null>(null);
  const activeSlotRef = useRef<'A' | 'B'>('A');
  const preloadedRef = useRef<{
    slot: 'A' | 'B';
    url: string;
    item: { data: ArrayBuffer; meta?: Record<string, unknown> };
  } | null>(null);
  const doubleBufferRef = useRef(false);

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

  const PCM_BATCH_BYTES = isMobile ? 14400 : 9600;
  const PCM_FLUSH_MS = isMobile ? 150 : 120;

  const SILENCE_MP3 = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRwMHAAAAAAD/+1DEAAAH+ANoUAAABNQKbgzRQAIAAADSAAAAEBof5c/KAgCAIHygIAgfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8H/+1DEKYAAADSAMAAAAAAA0gAAAAAygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHwfB8HwfB8oCAIAgCB8HwfB8HwfKAgCAIAgfB8HwfB8HygIAgCAIHw==';

  const createAudioEl = useCallback((): HTMLAudioElement => {
    const a = document.createElement('audio');
    a.setAttribute('playsinline', 'true');
    a.setAttribute('webkit-playsinline', 'true');
    (a as any).playsInline = true;
    a.preload = 'auto';
    document.body.appendChild(a);
    return a;
  }, []);

  const getSlot = useCallback((slot: 'A' | 'B'): HTMLAudioElement => {
    const ref = slot === 'A' ? audioRefA : audioRefB;
    if (!ref.current) ref.current = createAudioEl();
    return ref.current;
  }, [createAudioEl]);

  const init = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      if (unlockedRef.current) { resolve(); return; }

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

      const audioA = getSlot('A');
      audioA.src = SILENCE_MP3;
      audioA.volume = 1;
      const pA = audioA.play();

      if (!pA) { unlockedRef.current = false; resolve(); return; }

      pA.then(() => {
        if (!isMobile) {
          unlockedRef.current = true;
          console.log('[AudioPlayer] unlocked (desktop)');
          resolve();
          return;
        }

        const audioB = getSlot('B');
        audioB.src = SILENCE_MP3;
        audioB.volume = 1;
        const pB = audioB.play();

        if (!pB) {
          doubleBufferRef.current = false;
          unlockedRef.current = true;
          resolve();
          return;
        }

        pB.then(() => {
          doubleBufferRef.current = true;
          unlockedRef.current = true;
          console.log('[AudioPlayer] double-buffer unlocked');
          resolve();
        }).catch(() => {
          doubleBufferRef.current = false;
          unlockedRef.current = true;
          console.log('[AudioPlayer] single-buffer (slot B failed)');
          resolve();
        });
      }).catch(() => {
        unlockedRef.current = false;
        resolve();
      });
    });
  }, [getSlot, isMobile]);

  const pcm16ToWav = useCallback((audioData: ArrayBuffer, sampleRate: number): Blob => {
    const pcmData = new Uint8Array(audioData);
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);
    const byteRate = sampleRate * 2;
    const dataSize = pcmData.byteLength;

    view.setUint32(0, 0x52494646, false);
    view.setUint32(4, 36 + dataSize, true);
    view.setUint32(8, 0x57415645, false);
    view.setUint32(12, 0x666d7420, false);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    view.setUint32(36, 0x64617461, false);
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

  const playViaElement = useCallback(
    (item: { data: ArrayBuffer; meta?: Record<string, unknown> }, sampleRate: number) => {
      const slot = activeSlotRef.current;
      const audio = getSlot(slot);
      const nextSlot: 'A' | 'B' = slot === 'A' ? 'B' : 'A';

      let wavUrl: string;
      const preloaded = preloadedRef.current;

      if (preloaded && preloaded.slot === slot) {
        wavUrl = preloaded.url;
        preloadedRef.current = null;
      } else {
        if (preloaded) {
          URL.revokeObjectURL(preloaded.url);
          preloadedRef.current = null;
        }
        const wavBlob = pcm16ToWav(item.data, sampleRate);
        wavUrl = URL.createObjectURL(wavBlob);
        audio.src = wavUrl;
        audio.load();
      }

      currentUrlRef.current = wavUrl;

      const cleanup = () => {
        URL.revokeObjectURL(wavUrl);
        if (currentUrlRef.current === wavUrl) currentUrlRef.current = null;
      };

      audio.onended = () => {
        cleanup();
        if (doubleBufferRef.current) activeSlotRef.current = nextSlot;
        playNext();
      };
      audio.onerror = () => {
        cleanup();
        if (doubleBufferRef.current) activeSlotRef.current = nextSlot;
        playNext();
      };

      audio.play().catch(() => {
        cleanup();
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

      if (doubleBufferRef.current && queueRef.current.length > 0) {
        const next = queueRef.current[0];
        const nc = (next.meta?.codec as string | undefined)?.toLowerCase();
        if (nc === 'pcm16le' || nc === 'linear16' || nc === 'pcm16') {
          const shifted = queueRef.current.shift()!;
          const nextSr = Number(shifted.meta?.sampleRate) || 24000;
          const nextWav = pcm16ToWav(shifted.data, nextSr);
          const nextUrl = URL.createObjectURL(nextWav);
          const nextAudio = getSlot(nextSlot);
          nextAudio.src = nextUrl;
          nextAudio.load();
          preloadedRef.current = { slot: nextSlot, url: nextUrl, item: shifted };
        }
      }
    },
    [getSlot, pcm16ToWav],
  );

  const playNext = useCallback(() => {
    const preloaded = preloadedRef.current;

    if (queueRef.current.length === 0 && !preloaded) {
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

    if (preloaded) {
      playViaElement(preloaded.item, Number(preloaded.item.meta?.sampleRate) || 24000);
      return;
    }

    const item = queueRef.current.shift()!;
    const codec = (item.meta?.codec as string | undefined)?.toLowerCase();
    const sampleRate = Number(item.meta?.sampleRate) || 24000;
    const isPcm = codec === 'pcm16le' || codec === 'linear16' || codec === 'pcm16';

    if (isPcm) {
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

      playViaElement(item, sampleRate);
      return;
    }

    const audio = getSlot(activeSlotRef.current);
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
  }, [getSlot, isMobile, playPcmViaContext, playViaElement]);

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

    const audioA = audioRefA.current;
    if (audioA) { audioA.pause(); audioA.onended = null; audioA.onerror = null; audioA.src = ''; }
    const audioB = audioRefB.current;
    if (audioB) { audioB.pause(); audioB.onended = null; audioB.onerror = null; audioB.src = ''; }

    if (currentUrlRef.current) { URL.revokeObjectURL(currentUrlRef.current); currentUrlRef.current = null; }
    if (preloadedRef.current) { URL.revokeObjectURL(preloadedRef.current.url); preloadedRef.current = null; }

    activeSlotRef.current = 'A';
    nextStartRef.current = 0;
  }, []);

  return { isPlaying, enqueue, stop, init };
}
