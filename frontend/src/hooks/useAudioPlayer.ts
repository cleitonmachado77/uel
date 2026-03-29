'use client';
import { useRef, useCallback, useState } from 'react';

/**
 * Player de áudio compatível com mobile (iOS Safari / Android Chrome).
 *
 * Estratégia:
 * - Usa um único elemento <audio> persistente, criado e "aquecido" no gesto do usuário (init).
 * - No iOS, trocar o `src` e chamar `play()` fora de um gesto bloqueia.  Para contornar,
 *   usamos a técnica de manter o elemento sempre "quente": no init() tocamos um silêncio
 *   inline (data-URI) que desbloqueia o elemento para plays futuros via código.
 * - Fila de reprodução garante ordem e evita sobreposição.
 */
export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const unlockedRef = useRef(false);

  /**
   * DEVE ser chamado dentro de um handler de clique/toque do usuário.
   * Cria o <audio> e toca um silêncio para desbloquear autoplay no mobile.
   */
  const init = useCallback(() => {
    if (!audioRef.current) {
      const audio = document.createElement('audio');
      audio.setAttribute('playsinline', 'true');
      audio.setAttribute('webkit-playsinline', 'true');
      // Previne que o iOS pause música de fundo
      (audio as any).playsInline = true;
      audioRef.current = audio;
    }

    // Toca silêncio mínimo para desbloquear o elemento no iOS/Android
    if (!unlockedRef.current) {
      const audio = audioRef.current;
      // WAV PCM silencioso de ~100ms (44 bytes de header + dados zerados)
      const silenceDataUri =
        'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
      audio.src = silenceDataUri;
      audio.volume = 0;
      const p = audio.play();
      if (p) {
        p.then(() => {
          audio.pause();
          audio.volume = 1;
          audio.currentTime = 0;
          unlockedRef.current = true;
          console.log('[AudioPlayer] Unlocked for mobile playback');
        }).catch((e) => {
          console.warn('[AudioPlayer] Unlock play failed:', e);
          // Mesmo falhando, marcamos como tentado para não travar
          audio.volume = 1;
        });
      }
    }
  }, []);

  const playNext = useCallback(() => {
    if (queueRef.current.length === 0) {
      playingRef.current = false;
      setIsPlaying(false);
      return;
    }

    playingRef.current = true;
    setIsPlaying(true);

    const blobUrl = queueRef.current.shift()!;
    const audio = audioRef.current;
    if (!audio) {
      URL.revokeObjectURL(blobUrl);
      playingRef.current = false;
      setIsPlaying(false);
      return;
    }

    audio.onended = () => {
      URL.revokeObjectURL(blobUrl);
      playNext();
    };
    audio.onerror = () => {
      console.warn('[AudioPlayer] Playback error, skipping chunk');
      URL.revokeObjectURL(blobUrl);
      playNext();
    };

    // Atribui src e tenta play
    audio.src = blobUrl;
    // load() força o mobile a reconhecer a nova source
    audio.load();

    const playPromise = audio.play();
    if (playPromise) {
      playPromise.catch((err) => {
        console.warn('[AudioPlayer] play() rejected:', err.message);
        // Em mobile, se autoplay falhar, tentamos novamente após um pequeno delay
        // (às vezes o browser precisa de um tick para processar o load)
        setTimeout(() => {
          audio.play().catch(() => {
            // Se falhar de novo, descarta e segue
            URL.revokeObjectURL(blobUrl);
            playNext();
          });
        }, 100);
      });
    }
  }, []);

  const enqueue = useCallback((audioData: ArrayBuffer) => {
    const blob = new Blob([audioData], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    queueRef.current.push(url);
    if (!playingRef.current) {
      playNext();
    }
  }, [playNext]);

  const stop = useCallback(() => {
    queueRef.current.forEach(URL.revokeObjectURL);
    queueRef.current = [];
    playingRef.current = false;
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }
  }, []);

  return { isPlaying, enqueue, stop, init };
}
