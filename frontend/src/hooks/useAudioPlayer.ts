'use client';
import { useRef, useCallback, useState, useEffect } from 'react';

/**
 * Player de áudio compatível com mobile.
 * 
 * Usa DUAS estratégias em paralelo:
 * 1. AudioContext + decodeAudioData (preferido, funciona bem após unlock)
 * 2. <audio> element persistente no DOM como fallback
 * 
 * O init() tenta desbloquear ambos no gesto do usuário.
 * O enqueue() tenta AudioContext primeiro; se falhar, usa <audio>.
 */
export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const queueRef = useRef<ArrayBuffer[]>([]);
  const playingRef = useRef(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const ctxUnlockedRef = useRef(false);
  const audioElUnlockedRef = useRef(false);

  // Cria o <audio> element no DOM ao montar
  useEffect(() => {
    const audio = document.createElement('audio');
    audio.id = 'uel-audio-player';
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');
    audio.preload = 'auto';
    // Inserir no DOM é necessário para iOS
    audio.style.display = 'none';
    document.body.appendChild(audio);
    audioElRef.current = audio;

    return () => {
      audio.pause();
      audio.remove();
      audioElRef.current = null;
    };
  }, []);

  /**
   * DEVE ser chamado dentro de um handler de clique/toque.
   */
  const init = useCallback(() => {
    // --- Desbloqueia AudioContext ---
    if (!ctxRef.current) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (AC) ctxRef.current = new AC();
    }
    const ctx = ctxRef.current;
    if (ctx) {
      if (ctx.state === 'suspended') {
        ctx.resume().then(() => {
          ctxUnlockedRef.current = true;
          console.log('[AudioPlayer] AudioContext unlocked, state:', ctx.state);
        }).catch(() => {});
      } else if (ctx.state === 'running') {
        ctxUnlockedRef.current = true;
      }
      // Toca silêncio para ativar
      try {
        const buf = ctx.createBuffer(1, ctx.sampleRate * 0.01, ctx.sampleRate);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
      } catch {}
    }

    // --- Desbloqueia <audio> element ---
    const audio = audioElRef.current;
    if (audio && !audioElUnlockedRef.current) {
      // Toca silêncio WAV mínimo
      audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
      audio.volume = 0.01;
      const p = audio.play();
      if (p) {
        p.then(() => {
          audio.pause();
          audio.volume = 1;
          audioElUnlockedRef.current = true;
          console.log('[AudioPlayer] <audio> element unlocked');
        }).catch((e) => {
          console.warn('[AudioPlayer] <audio> unlock failed:', e.message);
          audio.volume = 1;
        });
      }
    }
  }, []);

  /**
   * Tenta reproduzir via AudioContext.
   */
  const playViaContext = useCallback((audioData: ArrayBuffer): Promise<boolean> => {
    return new Promise((resolve) => {
      const ctx = ctxRef.current;
      if (!ctx || ctx.state !== 'running') {
        resolve(false);
        return;
      }

      const copy = audioData.slice(0);
      ctx.decodeAudioData(copy).then((decoded) => {
        const source = ctx.createBufferSource();
        source.buffer = decoded;
        source.connect(ctx.destination);
        source.onended = () => resolve(true);
        source.start(0);
      }).catch((err) => {
        console.warn('[AudioPlayer] decodeAudioData failed:', err);
        resolve(false);
      });
    });
  }, []);

  /**
   * Fallback: reproduz via <audio> element.
   */
  const playViaElement = useCallback((audioData: ArrayBuffer): Promise<boolean> => {
    return new Promise((resolve) => {
      const audio = audioElRef.current;
      if (!audio) { resolve(false); return; }

      const blob = new Blob([audioData], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);

      audio.onended = () => { URL.revokeObjectURL(url); resolve(true); };
      audio.onerror = () => { URL.revokeObjectURL(url); resolve(false); };

      audio.src = url;
      audio.load();
      audio.play().then(() => {
        // Reproduzindo com sucesso
      }).catch(() => {
        URL.revokeObjectURL(url);
        resolve(false);
      });
    });
  }, []);

  const playNext = useCallback(async () => {
    if (queueRef.current.length === 0) {
      playingRef.current = false;
      setIsPlaying(false);
      return;
    }

    playingRef.current = true;
    setIsPlaying(true);

    const audioData = queueRef.current.shift()!;

    // Tenta AudioContext primeiro
    let played = await playViaContext(audioData);

    // Se falhou, tenta <audio> element
    if (!played) {
      console.log('[AudioPlayer] Falling back to <audio> element');
      played = await playViaElement(audioData);
    }

    if (!played) {
      console.warn('[AudioPlayer] Both methods failed, skipping chunk');
    }

    // Próximo da fila
    playNext();
  }, [playViaContext, playViaElement]);

  const enqueue = useCallback((audioData: ArrayBuffer) => {
    queueRef.current.push(audioData);
    if (!playingRef.current) {
      playNext();
    }
  }, [playNext]);

  const stop = useCallback(() => {
    queueRef.current = [];
    playingRef.current = false;
    setIsPlaying(false);
    const audio = audioElRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
    }
  }, []);

  return { isPlaying, enqueue, stop, init };
}
