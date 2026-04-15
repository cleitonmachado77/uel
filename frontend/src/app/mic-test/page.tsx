'use client';
/**
 * Página de diagnóstico de microfone — acessível em /mic-test
 * Abre no iPhone para ver exatamente qual microfone está sendo capturado
 * e se o áudio está chegando com sinal real.
 */
import { useState, useRef } from 'react';

interface DiagResult {
  step: string;
  ok: boolean;
  detail: string;
}

export default function MicTestPage() {
  const [results, setResults] = useState<DiagResult[]>([]);
  const [running, setRunning] = useState(false);
  const [volumeDb, setVolumeDb] = useState<number | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const addResult = (step: string, ok: boolean, detail: string) => {
    setResults((prev) => [...prev, { step, ok, detail }]);
  };

  const runDiag = async () => {
    setResults([]);
    setVolumeDb(null);
    setRunning(true);
    stopRef.current?.();

    // 1. Verificar suporte
    if (!navigator.mediaDevices?.getUserMedia) {
      addResult('API getUserMedia', false, 'Não suportado neste browser');
      setRunning(false);
      return;
    }
    addResult('API getUserMedia', true, 'Suportado');

    // 2. Listar dispositivos antes da permissão
    try {
      const devsBefore = await navigator.mediaDevices.enumerateDevices();
      const audioInputsBefore = devsBefore.filter((d) => d.kind === 'audioinput');
      addResult(
        'Dispositivos (antes da permissão)',
        audioInputsBefore.length > 0,
        `${audioInputsBefore.length} audioinput(s): ${audioInputsBefore.map((d) => d.label || d.deviceId.slice(0, 8) || '(sem label)').join(', ')}`
      );
    } catch (e: any) {
      addResult('Dispositivos (antes da permissão)', false, e.message);
    }

    // 3. Solicitar permissão com audio:true puro
    let stream: MediaStream | null = null;
    try {
      // Tenta capturar o dispositivo externo pelo deviceId (se disponível antes da permissão)
      const builtInKeywords = /iphone|ipad|ipod|built.?in|interno|embutido/i;
      const devsBefore2 = await navigator.mediaDevices.enumerateDevices();
      const inputsBefore = devsBefore2.filter((d) => d.kind === 'audioinput');
      const external = inputsBefore.find((d) => d.label && !builtInKeywords.test(d.label));
      if (external) {
        addResult('Microfone externo detectado', true, `Label: "${external.label}" | deviceId: ${external.deviceId.slice(0, 16)}`);
      } else {
        addResult('Microfone externo detectado', false, 'Nenhum dispositivo externo identificado — usando padrão');
      }

      const audioArg = external
        ? { deviceId: { exact: external.deviceId } }
        : true;
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioArg });
      const track = stream.getAudioTracks()[0];
      const settings = track?.getSettings() as any;
      addResult(
        `getUserMedia({ audio: ${external ? 'deviceId:exact' : 'true'} })`,
        true,
        `Label: "${track?.label || '(vazio)'}" | deviceId: ${settings?.deviceId?.slice(0, 12) || 'N/A'} | sampleRate: ${settings?.sampleRate ?? 'N/A'} | groupId: ${settings?.groupId?.slice(0, 12) || 'N/A'}`
      );
    } catch (e: any) {
      addResult('getUserMedia', false, e.message);
      setRunning(false);
      return;
    }

    // 4. Listar dispositivos depois da permissão
    try {
      const devsAfter = await navigator.mediaDevices.enumerateDevices();
      const audioInputsAfter = devsAfter.filter((d) => d.kind === 'audioinput');
      addResult(
        'Dispositivos (após permissão)',
        audioInputsAfter.length > 0,
        `${audioInputsAfter.length} audioinput(s): ${audioInputsAfter.map((d) => d.label || d.deviceId.slice(0, 8) || '(sem label)').join(' | ')}`
      );
    } catch (e: any) {
      addResult('Dispositivos (após permissão)', false, e.message);
    }

    // 5. Criar AudioContext SEM sampleRate fixo e medir volume
    try {
      const ACtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new ACtx();
      addResult('AudioContext sampleRate nativo', true, `${ctx.sampleRate} Hz`);

      const source = ctx.createMediaStreamSource(stream!);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let maxDb = -Infinity;
      let frames = 0;
      const maxFrames = 60; // ~1 segundo

      await ctx.resume();

      await new Promise<void>((resolve) => {
        const measure = () => {
          analyser.getByteFrequencyData(dataArray);
          const rms = Math.sqrt(dataArray.reduce((s, v) => s + v * v, 0) / dataArray.length);
          const db = rms > 0 ? 20 * Math.log10(rms / 255) : -Infinity;
          if (db > maxDb) maxDb = db;
          setVolumeDb(Math.round(db));
          frames++;
          if (frames < maxFrames) {
            requestAnimationFrame(measure);
          } else {
            resolve();
          }
        };
        requestAnimationFrame(measure);
      });

      const hasSignal = maxDb > -60;
      addResult(
        'Sinal de áudio (fale algo)',
        hasSignal,
        `Pico: ${maxDb === -Infinity ? '-∞' : Math.round(maxDb)} dB ${hasSignal ? '✅ Sinal detectado' : '❌ Silêncio — microfone não está capturando'}`
      );

      source.disconnect();
      ctx.close();
    } catch (e: any) {
      addResult('AudioContext / análise de volume', false, e.message);
    }

    // 6. Parar stream
    stream?.getTracks().forEach((t) => t.stop());
    setRunning(false);
  };

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6 font-mono text-sm">
      <h1 className="text-xl font-bold mb-2 text-green-400">🎙 Diagnóstico de Microfone</h1>
      <p className="text-gray-400 mb-6 text-xs">
        Conecte o microfone de lapela ANTES de iniciar. Fale durante o teste para verificar o sinal.
      </p>

      <button
        onClick={runDiag}
        disabled={running}
        className="mb-6 px-6 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-xl font-bold text-white"
      >
        {running ? '⏳ Testando... (fale algo)' : '▶ Iniciar Diagnóstico'}
      </button>

      {volumeDb !== null && running && (
        <div className="mb-4 text-yellow-300 text-lg">
          Volume atual: <span className="font-bold">{volumeDb} dB</span>
          <div className="w-full bg-gray-800 rounded-full h-3 mt-1">
            <div
              className="bg-green-500 h-3 rounded-full transition-all"
              style={{ width: `${Math.max(0, Math.min(100, (volumeDb + 80) * 1.25))}%` }}
            />
          </div>
        </div>
      )}

      <div className="space-y-3">
        {results.map((r, i) => (
          <div key={i} className={`rounded-lg p-3 border ${r.ok ? 'border-green-700 bg-green-950' : 'border-red-700 bg-red-950'}`}>
            <div className="flex items-center gap-2 mb-1">
              <span>{r.ok ? '✅' : '❌'}</span>
              <span className="font-bold text-white">{r.step}</span>
            </div>
            <p className="text-gray-300 text-xs break-all">{r.detail}</p>
          </div>
        ))}
      </div>

      {results.length > 0 && !running && (
        <p className="mt-6 text-gray-500 text-xs">
          Copie esses resultados e envie para o suporte técnico.
        </p>
      )}
    </main>
  );
}
