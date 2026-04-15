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

  const addResult = (step: string, ok: boolean, detail: string) => {
    setResults((prev) => [...prev, { step, ok, detail }]);
  };

  const runDiag = async () => {
    setResults([]);
    setVolumeDb(null);
    setRunning(true);

    if (!navigator.mediaDevices?.getUserMedia) {
      addResult('API getUserMedia', false, 'Não suportado neste browser');
      setRunning(false);
      return;
    }
    addResult('API getUserMedia', true, 'Suportado');

    // PASSO 1: listar dispositivos ANTES de qualquer permissão
    const listDevices = async (label: string) => {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const inputs = devs.filter((d) => d.kind === 'audioinput');
      addResult(
        label,
        inputs.length > 0,
        `${inputs.length} dispositivo(s): ${inputs.map((d, i) => `[${i}] "${d.label || '(sem label)'}" id:${d.deviceId.slice(0, 8)}`).join(' | ')}`
      );
      return inputs;
    };

    const inputsBefore = await listDevices('Dispositivos ANTES da permissão');

    // PASSO 2: abrir stream com audio:true para obter permissão
    let firstStream: MediaStream;
    try {
      firstStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const t = firstStream.getAudioTracks()[0];
      const s = t?.getSettings() as any;
      addResult('getUserMedia(audio:true)', true,
        `Label: "${t?.label}" | sampleRate: ${s?.sampleRate} | deviceId: ${s?.deviceId?.slice(0,12)}`);
    } catch (e: any) {
      addResult('getUserMedia(audio:true)', false, e.message);
      setRunning(false);
      return;
    }

    // PASSO 3: listar dispositivos APÓS permissão (iOS pode revelar mais agora)
    const inputsAfter = await listDevices('Dispositivos APÓS permissão');

    // PASSO 4: parar o stream inicial e tentar capturar cada dispositivo individualmente
    firstStream!.getTracks().forEach((t) => t.stop());

    const builtInKeywords = /iphone|ipad|ipod|built.?in|interno|embutido/i;
    const allInputs = inputsAfter.length > inputsBefore.length ? inputsAfter : inputsBefore;
    const external = allInputs.find((d) => d.label && !builtInKeywords.test(d.label));

    if (external) {
      addResult('Dispositivo externo identificado', true,
        `"${external.label}" | deviceId: ${external.deviceId.slice(0, 16)}`);

      // Tentar capturar especificamente o externo
      try {
        const extStream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: external.deviceId } }
        });
        const t = extStream.getAudioTracks()[0];
        const s = t?.getSettings() as any;
        addResult('getUserMedia(deviceId externo)', true,
          `Label: "${t?.label}" | sampleRate: ${s?.sampleRate} | deviceId: ${s?.deviceId?.slice(0,12)}`);

        // Medir volume do externo
        await measureVolume(extStream, addResult, setVolumeDb, 'Volume microfone externo');
        extStream.getTracks().forEach((t) => t.stop());
      } catch (e: any) {
        addResult('getUserMedia(deviceId externo)', false, e.message);
      }
    } else {
      addResult('Dispositivo externo identificado', false,
        'Nenhum externo encontrado. Testando volume do padrão...');
      // Medir volume do padrão mesmo assim
      try {
        const defStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        await measureVolume(defStream, addResult, setVolumeDb, 'Volume microfone padrão');
        defStream.getTracks().forEach((t) => t.stop());
      } catch (_) {}
    }

    setRunning(false);
  };

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6 font-mono text-sm">
      <h1 className="text-xl font-bold mb-2 text-green-400">🎙 Diagnóstico de Microfone</h1>
      <p className="text-gray-400 mb-6 text-xs">
        Conecte o microfone de lapela ANTES de iniciar. Fale durante o teste para verificar o sinal.
      </p>

      <button onClick={runDiag} disabled={running}
        className="mb-6 px-6 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-xl font-bold text-white">
        {running ? '⏳ Testando... (fale algo)' : '▶ Iniciar Diagnóstico'}
      </button>

      {volumeDb !== null && running && (
        <div className="mb-4 text-yellow-300 text-lg">
          Volume: <span className="font-bold">{volumeDb} dB</span>
          <div className="w-full bg-gray-800 rounded-full h-3 mt-1">
            <div className="bg-green-500 h-3 rounded-full transition-all"
              style={{ width: `${Math.max(0, Math.min(100, (volumeDb + 80) * 1.25))}%` }} />
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
    </main>
  );
}

async function measureVolume(
  stream: MediaStream,
  addResult: (s: string, ok: boolean, d: string) => void,
  setVolumeDb: (v: number) => void,
  label: string
) {
  const ACtx = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx = new ACtx();
  await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  let maxDb = -Infinity;

  await new Promise<void>((resolve) => {
    let frames = 0;
    const measure = () => {
      analyser.getByteFrequencyData(dataArray);
      const rms = Math.sqrt(dataArray.reduce((s, v) => s + v * v, 0) / dataArray.length);
      const db = rms > 0 ? 20 * Math.log10(rms / 255) : -Infinity;
      if (db > maxDb) maxDb = db;
      setVolumeDb(Math.round(db));
      if (++frames < 80) requestAnimationFrame(measure);
      else resolve();
    };
    requestAnimationFrame(measure);
  });

  source.disconnect();
  ctx.close();
  const hasSignal = maxDb > -60;
  addResult(label, hasSignal,
    `Pico: ${maxDb === -Infinity ? '-∞' : Math.round(maxDb)} dB — ${hasSignal ? '✅ Sinal real detectado' : '❌ Silêncio — microfone não captura'}`);
}
