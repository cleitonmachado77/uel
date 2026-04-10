'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { WSClient, WSMessage } from '@/lib/websocket';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useLocale } from '@/contexts/LocaleContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

type Session = {
  id: string;
  professorName: string;
  avatarUrl: string | null;
  subject: string;
  language: string;
  listeners: number;
  startedAt: string;
};

const TARGET_LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
  { code: 'zh', label: '中文', flag: '🇨🇳' },
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function StudentPage() {
  const { t } = useLocale();
  const { user, session: authSession } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [connected, setConnected] = useState(false);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [targetLang, setTargetLang] = useState('en');
  const targetLangRef = useRef(targetLang);
  const [loading, setLoading] = useState(true);
  const wsRef = useRef<WSClient | null>(null);
  const joiningRef = useRef(false);
  const { isPlaying, enqueue, stop: stopPlayer, init: initPlayer } = useAudioPlayer();

  // Busca sessões ativas
  const fetchSessions = async () => {
    try {
      const { data, error } = await supabase
        .from('sessions')
        .select(`
          id,
          subject,
          language,
          listener_count,
          started_at,
          professors ( id, name, department, avatar_url )
        `)
        .eq('status', 'live')
        .order('started_at', { ascending: false });

      if (error) throw error;

      setSessions(
        (data || []).map((s: any) => ({
          id: s.id,
          professorName: s.professors?.name || 'Professor',
          avatarUrl: s.professors?.avatar_url || null,
          subject: s.subject,
          language: s.language,
          listeners: s.listener_count,
          startedAt: s.started_at,
        }))
      );
    } catch {
      console.error('Erro ao buscar sessões');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(() => {
      if (!connected) fetchSessions(); // Não faz polling enquanto conectado
    }, 3000);

    const channel = supabase
      .channel('sessions-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sessions' },
        () => { fetchSessions(); }
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, []);

  const joinSession = async (session: Session) => {
    if (joiningRef.current) return;
    joiningRef.current = true;

    // Seleciona imediatamente no primeiro toque/click.
    setConnected(true);
    setCurrentSession(session);
    initPlayer().catch(() => {});

    const connectWs = async () => {
      const ws = new WSClient({
        onMessage: (msg: WSMessage) => {
          if (msg.type === 'joined') {
            ws.send({ type: 'student_set_language', language: targetLangRef.current });
          }
          if (msg.type === 'session_ended') {
            leaveSession();
          }
        },
        onAudio: (data: ArrayBuffer, meta?: Record<string, unknown>) => {
          enqueue(data, meta);
        },
        onClose: () => {
          setTimeout(() => {
            if (wsRef.current) connectWs();
          }, 2000);
        },
      });

      try {
        await ws.connect();
        wsRef.current = ws;
        ws.send({
          type: 'student_join',
          sessionId: session.id,
          language: targetLangRef.current,
          token: authSession?.access_token || null,
          studentId: user?.id || null,
        });
      } catch (err) {
        console.error('[Student] Connect failed:', err);
        setTimeout(() => {
          if (wsRef.current) connectWs();
        }, 3000);
      }
    };

    // Marca wsRef como ativo para permitir reconexão
    wsRef.current = {} as any;
    try {
      await connectWs();
    } finally {
      joiningRef.current = false;
    }
  };

  // Re-desbloqueia áudio ao tocar na tela (iOS pode suspender ao perder foco)
  useEffect(() => {
    if (!connected) return;
    const handleInteraction = () => { initPlayer(); };
    document.addEventListener('touchstart', handleInteraction, { once: true });
    return () => { document.removeEventListener('touchstart', handleInteraction); };
  }, [connected, initPlayer]);

  const leaveSession = () => {
    const ws = wsRef.current;
    wsRef.current = null; // Para a reconexão automática
    joiningRef.current = false;
    stopPlayer();
    ws?.disconnect();
    setConnected(false);
    setCurrentSession(null);
  };

  const changeLanguage = (lang: string) => {
    setTargetLang(lang);
    targetLangRef.current = lang;
    stopPlayer(); // Limpa fila de áudio do idioma anterior
    wsRef.current?.send({ type: 'student_set_language', language: lang });
  };

  return (
    <main className="relative min-h-screen flex flex-col px-6 py-8 pb-32">
      <div className="absolute inset-0 -z-10 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: 'url(/bg-app.jpg)' }}>
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      </div>
      {/* Header */}
      <div className="w-full max-w-md mx-auto mb-6">
        <a href="/" className="inline-flex items-center gap-1 px-4 py-2 rounded-full border border-white/20 bg-white/5 text-gray-300 text-sm hover:bg-white/10 hover:text-white transition-colors">
          {t('back')}
        </a>
      </div>

      <div className="w-full max-w-md mx-auto bg-black/40 backdrop-blur-md rounded-3xl p-6 border border-white/10">
        <h1 className="text-2xl font-bold text-primary mb-1">{t('student.title')}</h1>
        <p className="text-gray-400 text-sm mb-6">{t('student.subtitle')}</p>

        {/* Seletor de idioma */}
        <div className="mb-6">
          <label className="text-gray-400 text-xs uppercase tracking-wider mb-2 block">
            {t('student.translate_to')}
          </label>
          <div className="grid grid-cols-4 gap-2">
            {TARGET_LANGUAGES.map((l) => (
              <button key={l.code} onClick={() => changeLanguage(l.code)}
                className={`flex items-center justify-center gap-1 px-2 py-2 rounded-full text-xs transition-colors ${
                  targetLang === l.code ? 'bg-primary text-white' : 'bg-white/10 text-gray-400 hover:bg-white/20'
                }`}>
                <span>{l.flag}</span>
                <span>{l.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Lista de sessões */}
        <div className="space-y-3">
          {loading && (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-2 border-tertiary border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && sessions.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-400 text-lg">{t('student.no_classes')}</p>
              <p className="text-gray-500 text-sm mt-2">{t('student.wait')}</p>
            </div>
          )}

          {sessions.map((session) => (
            <button key={session.id} onClick={() => joinSession(session)} disabled={connected}
              className="w-full bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl p-4 text-left transition-colors disabled:opacity-50">
              <div className="flex items-center gap-4">
                {session.avatarUrl ? (
                  <img src={session.avatarUrl} alt="" className="w-12 h-12 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center text-primary font-bold text-lg shrink-0">
                    {session.professorName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-white font-semibold truncate">{session.professorName}</p>
                    <span className="flex items-center gap-1 text-xs text-red-400 bg-red-500/20 px-2 py-0.5 rounded-full shrink-0">
                      <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-live-pulse" />
                      LIVE
                    </span>
                  </div>
                  <p className="text-gray-400 text-sm truncate">{session.subject}</p>
                </div>
                <div className="text-gray-500 text-xs shrink-0">👤 {session.listeners}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Player fixo no rodapé (estilo Spotify) */}
      {connected && currentSession && (
        <div className="fixed bottom-0 left-0 right-0 bg-black/60 backdrop-blur-md border-t border-white/10 px-6 py-4">
          <div className="max-w-md mx-auto flex items-center gap-4">
            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm truncate">
                {currentSession.professorName}
              </p>
              <p className="text-gray-400 text-xs truncate">{currentSession.subject}</p>
            </div>

            {/* Indicador de áudio */}
            <div className="flex items-end gap-0.5 h-4">
              {isPlaying ? (
                [...Array(4)].map((_, i) => (
                  <div
                    key={i}
                    className="w-1 bg-primary rounded-full audio-bar"
                    style={{ animationDelay: `${i * 0.12}s` }}
                  />
                ))
              ) : (
                <span className="text-gray-500 text-xs">{t('student.waiting_audio')}</span>
              )}
            </div>

            {/* Botão sair */}
            <button
              onClick={leaveSession}
              className="bg-red-600/20 text-red-400 hover:bg-red-600/30 px-4 py-2 rounded-full text-sm transition-colors"
            >
              {t('student.leave')}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
