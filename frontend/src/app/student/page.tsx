'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useInworldWebRTC } from '@/hooks/useInworldWebRTC';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useProfessorAudioStream } from '@/hooks/useProfessorAudioStream';
import { useLocale } from '@/contexts/LocaleContext';
import { supabase } from '@/lib/supabase';
import { WSClient } from '@/lib/websocket';

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

export default function StudentPage() {
  const { t } = useLocale();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [connected, setConnected] = useState(false);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [targetLang, setTargetLang] = useState('en');
  const [connectError, setConnectError] = useState<string | null>(null);
  const targetLangRef = useRef(targetLang);
  const [loading, setLoading] = useState(true);
  const [pipelineReady, setPipelineReady] = useState(false);
  const joiningRef = useRef(false);
  const wsRef = useRef<WSClient | null>(null);
  const profStreamRef = useRef<MediaStream | null>(null);

  const leavingRef = useRef(false);
  const activeSessionRef = useRef<Session | null>(null);
  const wsReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { isPlaying, init: initPlayer, attachStream, stop: stopPlayer, setAudioElement } = useAudioPlayer();
  const { init: initProfStream, feedPcm, stop: stopProfStream } = useProfessorAudioStream();

  const { init: initWebRTC, stop: stopWebRTC, isConnecting } = useInworldWebRTC({
    onRemoteStream: (stream) => {
      console.log('[Student] WebRTC remote stream recebido');
      attachStream(stream);
    },
    onDebug: (msg) => console.log(msg),
    onError: (err) => {
      console.error('[Student WebRTC]', err.message);
    },
  });

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
      if (!connected) fetchSessions();
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

  const clearWsReconnectTimer = useCallback(() => {
    if (wsReconnectTimerRef.current) {
      clearTimeout(wsReconnectTimerRef.current);
      wsReconnectTimerRef.current = null;
    }
  }, []);

  const leaveSession = useCallback(() => {
    leavingRef.current = true;
    joiningRef.current = false;
    clearWsReconnectTimer();
    stopWebRTC();
    stopPlayer();
    stopProfStream();
    profStreamRef.current = null;
    activeSessionRef.current = null;
    wsRef.current?.disconnect();
    wsRef.current = null;
    setConnected(false);
    setCurrentSession(null);
    setConnectError(null);
    setPipelineReady(false);
    leavingRef.current = false;
  }, [stopWebRTC, stopPlayer, stopProfStream, clearWsReconnectTimer]);

  /** Reconnect WS after unexpected disconnect (keeps session alive during pauses) */
  const reconnectWs = useCallback((session: Session) => {
    if (leavingRef.current || !activeSessionRef.current) return;
    clearWsReconnectTimer();

    console.log('[Student] Reconectando WebSocket...');
    const ws = new WSClient({
      onMessage: (msg) => {
        if (msg.type === 'session_ended' || msg.type === 'error') {
          console.log('[Student] Sessão encerrada durante reconexão');
          leaveSession();
        }
      },
      onAudio: (audioData) => {
        feedPcm(audioData);
      },
      onClose: () => {
        console.log('[Student] WebSocket desconectado');
        wsRef.current = null;
        if (!leavingRef.current && activeSessionRef.current) {
          wsReconnectTimerRef.current = setTimeout(() => {
            wsReconnectTimerRef.current = null;
            reconnectWs(activeSessionRef.current!);
          }, 2000);
        }
      },
      onError: () => {},
    });

    ws.connect().then(() => {
      if (leavingRef.current || !activeSessionRef.current) {
        ws.disconnect();
        return;
      }
      console.log('[Student] WebSocket reconectado');
      ws.send({
        type: 'student_join',
        sessionId: session.id,
        language: targetLangRef.current,
      });
      wsRef.current = ws;
    }).catch(() => {
      if (!leavingRef.current && activeSessionRef.current) {
        wsReconnectTimerRef.current = setTimeout(() => {
          wsReconnectTimerRef.current = null;
          reconnectWs(session);
        }, 3000);
      }
    });
  }, [feedPcm, leaveSession, clearWsReconnectTimer]);

  const joinSession = async (session: Session) => {
    if (joiningRef.current || connected) return;
    joiningRef.current = true;
    leavingRef.current = false;
    console.log('[Student] joinSession iniciado para sessão:', session.id);

    try {
      setConnectError(null);
      setCurrentSession(session);
      activeSessionRef.current = session;

      console.log('[Student] Conectando WebSocket...');
      const ws = new WSClient({
        onMessage: (msg) => {
          if (msg.type === 'session_ended') {
            console.log('[Student] Sessão encerrada pelo professor');
            leaveSession();
          }
        },
        onAudio: (audioData) => {
          feedPcm(audioData);
        },
        onClose: () => {
          console.log('[Student] WebSocket desconectado');
          wsRef.current = null;
          // Auto-reconnect if not intentionally leaving
          if (!leavingRef.current && activeSessionRef.current) {
            wsReconnectTimerRef.current = setTimeout(() => {
              wsReconnectTimerRef.current = null;
              reconnectWs(activeSessionRef.current!);
            }, 2000);
          }
        },
        onError: () => {
          setConnectError('Erro na conexão WebSocket');
        },
      });

      await ws.connect();
      console.log('[Student] WebSocket conectado, enviando student_join...');
      ws.send({
        type: 'student_join',
        sessionId: session.id,
        language: targetLangRef.current,
      });
      wsRef.current = ws;

      setConnected(true);
      console.log('[Student] Conectado! Iniciando pipeline de áudio...');

      startAudioPipeline(targetLangRef.current);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao conectar';
      console.error('[Student] joinSession erro:', message);
      setConnectError(message);
      setCurrentSession(null);
      activeSessionRef.current = null;
      setConnected(false);
      wsRef.current?.disconnect();
      wsRef.current = null;
    } finally {
      joiningRef.current = false;
    }
  };

  /** Runs in background after WS connection is established */
  const startAudioPipeline = async (lang: string) => {
    setPipelineReady(false);
    try {
      console.log('[Student] Desbloqueando áudio...');
      await initPlayer();

      console.log('[Student] Criando professor audio stream...');
      const profMediaStream = initProfStream();
      profStreamRef.current = profMediaStream;

      console.log('[Student] Iniciando WebRTC com Inworld...');
      await initWebRTC(lang, profMediaStream);
      console.log('[Student] WebRTC iniciado com sucesso');
      setPipelineReady(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro no pipeline de áudio';
      console.warn('[Student] Pipeline de áudio falhou (reconexão automática):', msg);
    }
  };

  const changingLangRef = useRef(false);

  const changeLanguage = async (lang: string) => {
    if (lang === targetLangRef.current || changingLangRef.current) return;
    changingLangRef.current = true;

    setTargetLang(lang);
    targetLangRef.current = lang;
    wsRef.current?.send({ type: 'student_set_language', language: lang });

    if (!connected) {
      changingLangRef.current = false;
      return;
    }

    // Restart WebRTC pipeline with new language (session.update is unreliable)
    console.log(`[Student] Trocando idioma para ${lang}, reiniciando WebRTC...`);
    setPipelineReady(false);

    try {
      stopWebRTC();

      // Reuse existing profStream if available, otherwise create new one
      let profStream = profStreamRef.current;
      if (!profStream) {
        profStream = initProfStream();
        profStreamRef.current = profStream;
      }

      await initWebRTC(lang, profStream);
      console.log('[Student] WebRTC reiniciado com novo idioma');
      setPipelineReady(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao trocar idioma';
      console.warn('[Student] Falha ao trocar idioma:', msg);
    } finally {
      changingLangRef.current = false;
    }
  };

  useEffect(() => {
    return () => {
      leavingRef.current = true;
      clearWsReconnectTimer();
      wsRef.current?.disconnect();
      wsRef.current = null;
      activeSessionRef.current = null;
      stopProfStream();
    };
  }, [clearWsReconnectTimer, stopProfStream]);

  return (
    <main className="relative min-h-screen flex flex-col px-6 py-8 pb-32">
      <div className="absolute inset-0 -z-10 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: 'url(/bg-app.jpg)' }}>
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      </div>
      <div className="w-full max-w-md mx-auto mb-6">
        <a href="/" className="inline-flex items-center gap-1 px-4 py-2 rounded-full border border-white/20 bg-white/5 text-gray-300 text-sm hover:bg-white/10 hover:text-white transition-colors">
          {t('back')}
        </a>
      </div>

      <div className="w-full max-w-md mx-auto bg-black/40 backdrop-blur-md rounded-3xl p-6 border border-white/10">
        <h1 className="text-2xl font-bold text-primary mb-1">{t('student.title')}</h1>
        <p className="text-gray-400 text-sm mb-6">{t('student.subtitle')}</p>
        <audio ref={setAudioElement} autoPlay playsInline className="hidden" />

        {connectError && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {connectError}
          </div>
        )}

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
            <button key={session.id} onClick={() => joinSession(session)} disabled={connected || isConnecting}
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

      {connected && currentSession && (
        <div className="fixed bottom-0 left-0 right-0 bg-black/60 backdrop-blur-md border-t border-white/10 px-6 py-4">
          <div className="max-w-md mx-auto flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm truncate">
                {currentSession.professorName}
              </p>
              <p className="text-gray-400 text-xs truncate">{currentSession.subject}</p>
            </div>

            <div className="flex items-center gap-1.5 h-5 shrink-0">
              {isPlaying ? (
                <div className="flex items-end gap-0.5 h-4">
                  {[...Array(4)].map((_, i) => (
                    <div
                      key={i}
                      className="w-1 bg-primary rounded-full audio-bar"
                      style={{ animationDelay: `${i * 0.12}s` }}
                    />
                  ))}
                </div>
              ) : !pipelineReady ? (
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 border-[1.5px] border-primary/60 border-t-primary rounded-full animate-spin" />
                  <span className="text-primary/60 text-[10px] tracking-wide">{t('student.initializing')}</span>
                </div>
              ) : (
                <span className="text-gray-500 text-xs">{t('student.waiting_audio')}</span>
              )}
            </div>

            <button
              onClick={leaveSession}
              className="bg-red-600/20 text-red-400 hover:bg-red-600/30 px-4 py-2 rounded-full text-sm transition-colors shrink-0"
            >
              {t('student.leave')}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
