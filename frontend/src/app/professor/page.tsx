'use client';
import { useState, useRef, useEffect } from 'react';
import { WSClient } from '@/lib/websocket';
import { useAuth } from '@/contexts/AuthContext';
import { useLocale } from '@/contexts/LocaleContext';
import { supabase } from '@/lib/supabase';
import { LOCALES } from '@/lib/i18n';

/**
 * Detecta se o browser é Safari/iOS.
 */
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/**
 * Retorna a versão principal do iOS, ou 0 se não for iOS.
 * iOS 16+ tem um bug no AVAudioSession onde o input é sempre o microfone
 * embutido, independente de microfones externos conectados. Isso afeta
 * qualquer app web via Safari pois o browser usa AVAudioSession internamente.
 * Não há solução via Web API — é uma limitação do sistema operacional.
 */
function getIOSVersion(): number {
  if (typeof navigator === 'undefined') return 0;
  const match = navigator.userAgent.match(/OS (\d+)_/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Lista dispositivos de entrada de áudio SEM abrir popup de permissão.
 * Usa apenas enumerateDevices() — se a permissão já foi concedida antes,
 * os labels aparecem; caso contrário, retorna lista vazia (sem pedir permissão).
 * Nunca chama getUserMedia aqui para evitar o loop de popup no iOS.
 */
async function listAudioInputDevices(): Promise<MediaDeviceInfo[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
  } catch (_) {
    return [];
  }
}

/**
 * Captures PCM16LE from a MediaStream and calls onChunk with base64 data.
 * Returns a cleanup function that stops the capture.
 */
function startPcmRelay(
  stream: MediaStream,
  onChunk: (b64: string) => void,
): () => void {
  const ACtx = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new ACtx({ sampleRate: 24000 });
  const source = audioCtx.createMediaStreamSource(stream);
  const processor = audioCtx.createScriptProcessor(2048, 1, 1);

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const pcmBuffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(pcmBuffer);
    for (let i = 0; i < input.length; i++) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    const bytes = new Uint8Array(pcmBuffer);
    let raw = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      raw += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    onChunk(btoa(raw));
  };

  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioCtx.destination);
  audioCtx.resume().catch(() => {});

  return () => {
    try {
      processor.disconnect();
      source.disconnect();
      mute.disconnect();
      audioCtx.close();
    } catch (_) {}
  };
}

export default function ProfessorPage() {
  const { user, session: authSession } = useAuth();
  const { locale, t } = useLocale();
  const [status, setStatus] = useState<'idle' | 'live' | 'connecting'>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [professorName, setProfessorName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [iosExternalMicWarning, setIosExternalMicWarning] = useState(false);
  const wsRef = useRef<WSClient | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const stopRelayRef = useRef<(() => void) | null>(null);
  const startingRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('professors')
      .select('name, avatar_url')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setProfessorName(data.name);
          setAvatarUrl(data.avatar_url ? `${data.avatar_url}?t=${Date.now()}` : null);
        }
      });
  }, [user]);

  // Carrega a lista de microfones disponíveis ao montar o componente.
  // Não chama getUserMedia aqui — apenas lê o que o browser já conhece.
  // No iOS isso retorna lista vazia (iOS não expõe múltiplos audioinput),
  // então o seletor simplesmente não aparece, o que é o comportamento correto.
  useEffect(() => {
    listAudioInputDevices().then((devices) => {
      setAudioDevices(devices);
      if (devices.length > 0) setSelectedDeviceId(devices[0].deviceId);
    });

    // iOS 16+ tem um bug no AVAudioSession que faz o input ser sempre o
    // microfone embutido, mesmo com microfone externo conectado.
    // Isso afeta qualquer app web via Safari — não há solução via Web API.
    if (isIOS() && getIOSVersion() >= 16) {
      setIosExternalMicWarning(true);
    }
  }, []);

  const cleanupAll = () => {
    stopRelayRef.current?.();
    stopRelayRef.current = null;
    if (micStreamRef.current) {
      for (const track of micStreamRef.current.getTracks()) track.stop();
      micStreamRef.current = null;
    }
  };

  const startSession = async () => {
    if (!subject.trim() || startingRef.current) return;
    startingRef.current = true;
    setStatus('connecting');

    try {
      console.log('[Professor] Solicitando microfone...');
      const ios = isIOS();

      // No iOS, qualquer constraint adicional faz o sistema ignorar microfones
      // externos e usar apenas o embutido. Passamos `audio: true` puro para
      // que o iOS use o microfone ativo no sistema (externo, se conectado).
      // Em outros browsers, aplicamos as constraints normalmente.
      let micStream: MediaStream;
      if (ios) {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else {
        const audioConstraints: MediaTrackConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {}),
        };
        micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      }

      micStreamRef.current = micStream;
      const activeTrack = micStream.getAudioTracks()[0];
      console.log('[Professor] Microfone obtido:', activeTrack?.label, '| iOS:', ios);

      const ws = new WSClient({
        onMessage: (msg) => {
          if (msg.type === 'session_created') {
            const sid = msg.sessionId as string;
            console.log('[Professor] Sessão criada:', sid);
            setSessionId(sid);
            setStatus('live');

            stopRelayRef.current?.();
            stopRelayRef.current = startPcmRelay(micStream, (b64) => {
              wsRef.current?.send({ type: 'audio_chunk', data: b64 });
            });
            console.log('[Professor] PCM relay iniciado');
          }
          if (msg.type === 'session_stopped') {
            setStatus('idle');
            setSessionId(null);
          }
          if (msg.type === 'error') {
            console.error('[Professor] WS error:', msg.message);
            setStatus('idle');
          }
        },
        onClose: () => {
          console.log('[Professor] WebSocket desconectado');
          cleanupAll();
          setStatus((prev) => (prev === 'live' ? 'idle' : prev));
        },
      });

      await ws.connect();
      wsRef.current = ws;
      console.log('[Professor] WebSocket conectado, enviando professor_start...');

      ws.send({
        type: 'professor_start',
        token: authSession?.access_token,
        professorId: user?.id,
        professorName,
        subject,
        language: 'pt',
      });
    } catch (err) {
      console.error('[Professor] Erro ao iniciar sessão:', err);
      setStatus('idle');
      cleanupAll();
    } finally {
      startingRef.current = false;
    }
  };

  const stopSession = () => {
    if (sessionId) {
      wsRef.current?.send({ type: 'professor_stop', sessionId });
    }
    cleanupAll();
    wsRef.current?.disconnect();
    wsRef.current = null;
    setStatus('idle');
    setSessionId(null);
  };

  useEffect(() => {
    return () => {
      cleanupAll();
      wsRef.current?.disconnect();
      wsRef.current = null;
    };
  }, []);

  return (
    <main className="relative min-h-screen flex flex-col items-center px-6 py-8">
      <div className="absolute inset-0 -z-10 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: 'url(/bg-app.jpg)' }}>
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      </div>
      <div className="w-full max-w-md mb-6">
        <a href="/" className="inline-flex items-center gap-1 px-4 py-2 rounded-full border border-white/20 bg-white/5 text-gray-300 text-sm hover:bg-white/10 hover:text-white transition-colors">
          {t('back')}
        </a>
      </div>

      <div className="w-full max-w-md bg-black/40 backdrop-blur-md rounded-3xl p-6 border border-white/10">
        <h1 className="text-2xl font-bold text-primary mb-1">{t('professor.title')}</h1>
        <p className="text-gray-400 text-sm mb-6">{t('professor.subtitle')}</p>

      {status === 'idle' && (
        <div className="space-y-4">
          <div className="flex items-center gap-4 bg-white/5 rounded-2xl p-4 border border-white/10">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-14 h-14 rounded-full object-cover" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xl">
                {professorName.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-white font-semibold">{professorName}</p>
              <p className="text-gray-500 text-xs">
                {t('professor.lang_label').replace(/:.+/, `: ${LOCALES.find(l => l.code === locale)?.label || locale} ${LOCALES.find(l => l.code === locale)?.flag || ''}`)}
              </p>
            </div>
          </div>

          {iosExternalMicWarning && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3 text-yellow-300 text-xs space-y-1">
              <p className="font-semibold">⚠️ Limitação do iOS 16+</p>
              <p>
                O Safari no iOS 16 e versões mais recentes não permite que apps web acessem microfones externos (lapela, headset). O sistema sempre usa o microfone embutido do dispositivo, independente do que estiver conectado.
              </p>
              <p className="text-yellow-400/70">
                Para usar o microfone de lapela, grave o áudio com o app de Câmera ou Voice Memos do iPhone e compartilhe depois.
              </p>
            </div>
          )}

          {audioDevices.length > 1 && (
            <div className="space-y-1">
              <label className="text-gray-400 text-xs px-1">🎙 Microfone</label>
              <select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                className="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-primary focus:outline-none appearance-none cursor-pointer"
              >
                {audioDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId} className="bg-gray-900 text-white">
                    {device.label || `Microfone ${audioDevices.indexOf(device) + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          <input type="text" placeholder={t('professor.subject')} value={subject} onChange={(e) => setSubject(e.target.value)}
            className="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:border-primary focus:outline-none" />

          <button onClick={startSession} disabled={!subject.trim()}
            className="w-full bg-primary hover:bg-primary-dark disabled:opacity-50 text-white font-semibold py-4 rounded-2xl transition-colors flex items-center justify-center gap-2">
            <span className="w-3 h-3 bg-red-500 rounded-full" />
            {t('professor.start')}
          </button>
        </div>
      )}

      {status === 'connecting' && (
        <div className="flex flex-col items-center gap-4 py-12">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400">{t('professor.connecting')}</p>
        </div>
      )}

      {status === 'live' && (
        <div className="flex flex-col items-center gap-6 py-4">
          <div className="flex items-center gap-2 bg-red-500/20 text-red-400 px-4 py-2 rounded-full">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-live-pulse" />
            {t('professor.live')}
          </div>

          <div className="flex items-end gap-1 h-16">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="w-2 bg-primary rounded-full audio-bar" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>

          <div className="text-center">
            {avatarUrl && <img src={avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover mx-auto mb-3" />}
            <p className="text-white font-semibold text-lg">{professorName}</p>
            <p className="text-gray-400 text-sm">{subject}</p>
          </div>

          {sessionId && (
            <p className="text-gray-600 text-xs font-mono">ID: {sessionId.slice(0, 8)}...</p>
          )}

          <button onClick={stopSession}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-4 rounded-2xl transition-colors">
            {t('professor.stop')}
          </button>
        </div>
      )}
      </div>
    </main>
  );
}
