'use client';
import { useState, useRef, useEffect } from 'react';
import { WSClient } from '@/lib/websocket';
import { useAuth } from '@/contexts/AuthContext';
import { useLocale } from '@/contexts/LocaleContext';
import { supabase } from '@/lib/supabase';
import { LOCALES } from '@/lib/i18n';

const TARGET_SAMPLE_RATE = 24000;

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
 * Lista dispositivos de entrada de áudio SEM abrir popup de permissão.
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
 * Retorna o deviceId do melhor microfone disponível.
 *
 * No iOS, antes de chamar getUserMedia, o browser já expõe os deviceIds
 * de todos os dispositivos conectados (incluindo externos). Após getUserMedia
 * sem deviceId, o iOS esconde os externos da lista.
 *
 * Estratégia: enumerar ANTES da captura e preferir dispositivos externos
 * (qualquer coisa que não seja o microfone embutido do iPhone/iPad).
 * Se não houver externo, retorna undefined (usa o padrão do sistema).
 */
async function pickBestMicDeviceId(): Promise<string | undefined> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === 'audioinput');
    if (inputs.length <= 1) return undefined;

    // Palavras-chave que identificam o microfone embutido
    const builtInKeywords = /iphone|ipad|ipod|built.?in|interno|embutido/i;

    // Prefere qualquer dispositivo que NÃO seja o embutido
    const external = inputs.find((d) => d.label && !builtInKeywords.test(d.label));
    if (external) {
      console.log('[Professor] Microfone externo detectado:', external.label, external.deviceId);
      return external.deviceId;
    }
  } catch (_) {}
  return undefined;
}

/**
 * Downsampling linear simples de sourceSampleRate → TARGET_SAMPLE_RATE.
 * Usado quando o AudioContext nativo opera em 44100/48000 Hz (iOS com mic externo).
 */
function downsample(input: Float32Array, sourceSampleRate: number): Float32Array {
  if (sourceSampleRate === TARGET_SAMPLE_RATE) return input;
  const ratio = sourceSampleRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    output[i] = input[Math.floor(i * ratio)];
  }
  return output;
}

/**
 * Converte Float32Array para PCM16LE base64.
 */
function float32ToPcm16Base64(samples: Float32Array): string {
  const pcmBuffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(pcmBuffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(pcmBuffer);
  let raw = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    raw += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(raw);
}

/**
 * Captura PCM16LE de um MediaStream e chama onChunk com dados base64.
 *
 * IMPORTANTE — iOS com microfone externo:
 * O iOS Safari NÃO aceita AudioContext com sampleRate customizado quando
 * um microfone externo está conectado. O hardware externo pode operar em
 * 44100 ou 48000 Hz, e forçar 24000 Hz faz o contexto falhar silenciosamente
 * ou capturar do microfone embutido.
 *
 * Solução: criar o AudioContext SEM especificar sampleRate (usa o nativo do
 * hardware), capturar no rate nativo, e fazer downsampling manual para 24000 Hz.
 */
function startPcmRelay(
  stream: MediaStream,
  onChunk: (b64: string) => void,
): () => void {
  const ACtx = window.AudioContext || (window as any).webkitAudioContext;

  // Sem sampleRate fixo — o browser/iOS usa o rate nativo do dispositivo de áudio
  const audioCtx = new ACtx();
  const nativeSampleRate = audioCtx.sampleRate;
  console.log('[Professor] AudioContext sampleRate nativo:', nativeSampleRate);

  const source = audioCtx.createMediaStreamSource(stream);
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);

    // Faz downsampling se necessário (ex: 44100 → 24000, 48000 → 24000)
    const resampled = downsample(input, nativeSampleRate);
    const b64 = float32ToPcm16Base64(resampled);
    onChunk(b64);
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
  // Não chama getUserMedia aqui para evitar popup de permissão no iOS.
  useEffect(() => {
    listAudioInputDevices().then((devices) => {
      setAudioDevices(devices);
      if (devices.length > 0) setSelectedDeviceId(devices[0].deviceId);
    });
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
      const ios = isIOS();
      console.log('[Professor] Solicitando microfone... iOS:', ios);

      // No iOS: enumerar dispositivos ANTES de getUserMedia para capturar
      // o deviceId do microfone externo (lapela, headset). Após getUserMedia
      // sem deviceId, o iOS esconde os externos da lista.
      // Em outros browsers: usar constraints de qualidade + deviceId do seletor.
      let micStream: MediaStream;
      if (ios) {
        const externalDeviceId = await pickBestMicDeviceId();
        const audioConstraints: MediaTrackConstraints = externalDeviceId
          ? { deviceId: { exact: externalDeviceId } }
          : {};
        console.log('[Professor] iOS deviceId escolhido:', externalDeviceId ?? '(padrão do sistema)');
        micStream = await navigator.mediaDevices.getUserMedia({ audio: Object.keys(audioConstraints).length ? audioConstraints : true });
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
      const settings = activeTrack?.getSettings();
      console.log('[Professor] Microfone obtido:', activeTrack?.label, '| sampleRate:', settings?.sampleRate);

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
