import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ComparisonPlayer, concatPcm, decodePcm, encodePcm, wavBytes, RATE } from '../utils/voiceComparison';

type Provider = 'live' | 'gemini';
type Phase = 'idle' | 'preparing' | 'recording' | 'receiving' | 'finished' | 'failed';
type Result = { input: string; output: string; done: boolean; error?: string; usageSeconds?: number; turnCompletionConfirmed?: boolean };
const empty = (): Record<Provider, Result> => ({ live: { input: '', output: '', done: false }, gemini: { input: '', output: '', done: false } });
const names = { live: 'GPT-Live 1', gemini: '현재 Gemini' };
const messages: Record<string, string> = {
  OPENAI_NOT_CONFIGURED: '앱 서버에 OpenAI 키 연결이 아직 필요합니다. 기존 Gemini 앱은 계속 사용할 수 있습니다.',
  AUTH_REQUIRED: '로그인을 다시 확인해 주세요. 이 시험은 앱 소유자만 사용할 수 있습니다.',
  ALREADY_RUNNING: '다른 창에서 비교 시험이 진행 중입니다. 그 시험을 종료한 뒤 다시 시작해 주세요.',
  OPENAI_HTTP_401: '앱 서버의 OpenAI 키 인증에 실패했습니다.',
  OPENAI_HTTP_403: 'OpenAI 모델 사용 권한을 확인해야 합니다.',
  OPENAI_HTTP_429: 'OpenAI 사용량 또는 요청 제한에 걸렸습니다.',
};
type Run = {
  phase: Phase; source: string; primary: Provider; startedAt: number; readyAt?: number; stoppedAt?: number;
  context: AudioContext; socket?: WebSocket; stream?: MediaStream; worklet?: AudioWorkletNode;
  inputNode?: MediaStreamAudioSourceNode; timer?: ReturnType<typeof setTimeout>; tick?: ReturnType<typeof setInterval>;
  input: Uint8Array[]; players: Record<Provider, ComparisonPlayer>; results: Record<Provider, Result>;
  inputEvidence?: object; filePcm?: Uint8Array; fileOffset: number; cancelled: boolean; flush?: () => void;
};

function download(name: string, value: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function VoiceComparisonPanel({ getToken }: { getToken: () => Promise<string> }) {
  const [source, setSource] = useState('ko'), [primary, setPrimary] = useState<Provider>('live');
  const [phase, setPhase] = useState<Phase>('idle'), [error, setError] = useState('');
  const [results, setResults] = useState(empty), [seconds, setSeconds] = useState(0), [, refresh] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const current = useRef<Run | null>(null), replay = useRef<HTMLAudioElement | null>(null);
  const busy = phase === 'preparing' || phase === 'recording' || phase === 'receiving';
  function stopReplay() { if (replay.current) { replay.current.pause(); URL.revokeObjectURL(replay.current.src); replay.current = null; } }
  function closeInput(r: Run) {
    r.stream?.getTracks().forEach(t => t.stop()); r.inputNode?.disconnect(); r.worklet?.disconnect();
    clearTimeout(r.timer); clearInterval(r.tick);
  }
  function cancel(r: Run | null) {
    if (!r) return;
    r.cancelled = true; closeInput(r); r.flush?.(); r.socket?.close();
    Object.values(r.players).forEach(p => p.cancel()); void r.context.close().catch(() => {});
  }
  function fail(r: Run, message: string) {
    if (r.cancelled || current.current !== r) return;
    cancel(r); r.phase = 'failed'; setPhase('failed'); setError(message);
  }
  useEffect(() => {
    const hidden = () => { if (document.hidden && current.current && !['finished', 'failed'].includes(current.current.phase)) {
      fail(current.current, '앱이 화면에서 벗어나 시험을 중단했습니다. 화면을 켜 둔 상태에서 다시 시험해 주세요.');
    } };
    document.addEventListener('visibilitychange', hidden);
    return () => { document.removeEventListener('visibilitychange', hidden); cancel(current.current); stopReplay(); };
  }, []);

  function sendPcm(r: Run, bytes: Uint8Array) {
    if (r.cancelled || !bytes.length) return;
    const total = r.input.reduce((n, p) => n + p.length, 0);
    const pcm = bytes.slice(0, Math.max(0, 30 * RATE * 2 - total));
    if (!pcm.length) return;
    if (r.socket?.readyState !== WebSocket.OPEN || r.socket.bufferedAmount > 500000) {
      fail(r, '녹음 전송이 지연되어 시험을 중단했습니다. 연결 상태를 확인해 주세요.'); return;
    }
    r.input.push(pcm); r.socket.send(JSON.stringify({ type: 'audio', audio: encodePcm(pcm) }));
  }
  async function stop(r: Run) {
    if (r.cancelled || r.phase !== 'recording') return;
    r.phase = 'receiving'; r.stoppedAt = performance.now(); setPhase('receiving');
    clearTimeout(r.timer); clearInterval(r.tick);
    // Stop the microphone before any translated audio can reach the speaker.
    r.stream?.getTracks().forEach(t => t.stop());
    const resume = r.context.resume(); // User gesture unlock for iPhone.
    if (r.worklet) {
      await new Promise<void>(resolve => {
        const timeout = setTimeout(() => { fail(r, '녹음 종료를 확인하지 못했습니다. 다시 시험해 주세요.'); resolve(); }, 2000);
        r.flush = () => { clearTimeout(timeout); resolve(); };
        r.worklet!.port.postMessage('stop');
      });
    }
    closeInput(r);
    if (r.cancelled) return;
    if (!r.input.length) { fail(r, '녹음된 소리가 없습니다. 마이크 권한을 확인해 주세요.'); return; }
    try {
      await resume;
      if (r.cancelled) return;
      r.socket!.send(JSON.stringify({ type: 'stop' }));
      Object.values(r.players).forEach(p => p.release(r.stoppedAt!));
    } catch { fail(r, '음성 재생을 시작하지 못했습니다. 다시 시험해 주세요.'); }
  }

  async function begin() {
    cancel(current.current); stopReplay(); setError(''); setResults(empty()); setSeconds(0); setPhase('preparing');
    let context: AudioContext;
    try { context = new AudioContext(); }
    catch { setPhase('failed'); setError('이 브라우저에서 음성 시험을 시작하지 못했습니다. Safari 또는 Chrome에서 열어 주세요.'); return; }
    const r: Run = { phase: 'preparing', source, primary, startedAt: performance.now(), context,
      input: [], players: { live: new ComparisonPlayer(context, primary === 'live'), gemini: new ComparisonPlayer(context, primary === 'gemini') },
      results: empty(), fileOffset: 0, cancelled: false };
    current.current = r;
    context.onstatechange = () => {
      if (!r.cancelled && (r.phase === 'recording' || r.phase === 'receiving') && context.state !== 'running') {
        r.players.live.audioClockInterrupted = true; r.players.gemini.audioClockInterrupted = true;
        fail(r, '오디오 재생이 중단되어 시간 측정을 멈췄습니다. 화면을 켜 둔 상태에서 다시 시험해 주세요.');
      }
    };
    try {
      await context.resume();
      if (file) {
        const decoded = await context.decodeAudioData(await file.arrayBuffer());
        if (decoded.duration <= 0 || decoded.duration > 30) throw new Error('FILE_DURATION');
        const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * RATE), RATE);
        const node = offline.createBufferSource(); node.buffer = decoded; node.connect(offline.destination); node.start();
        const mono = (await offline.startRendering()).getChannelData(0);
        const bytes = new Uint8Array(mono.length * 2), view = new DataView(bytes.buffer);
        mono.forEach((value, i) => { const v = Math.max(-1, Math.min(1, value)); view.setInt16(i * 2, Math.round(v * (v < 0 ? 32768 : 32767)), true); });
        r.filePcm = bytes;
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
        if (r.cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        r.stream = stream;
        await context.audioWorklet.addModule('/voice-compare-recorder.mjs');
      }
      const token = await getToken();
      if (r.cancelled) return;
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/voice-compare`);
      r.socket = ws;
      r.timer = setTimeout(() => fail(r, '연결 준비 시간이 초과되었습니다.'), 30000);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token, source: r.source }));
      ws.onerror = () => fail(r, '비교 서버에 연결하지 못했습니다.');
      ws.onclose = () => { if (!r.cancelled && r.phase !== 'finished') fail(r, '시험 연결이 종료되었습니다. 받은 결과는 아래에서 확인할 수 있습니다.'); };
      ws.onmessage = event => {
        if (r.cancelled) return;
        try {
          const m = JSON.parse(event.data);
          if (m.type === 'error') { fail(r, messages[m.code] ?? `시험을 중단했습니다. (${m.code})`); return; }
          if (m.type === 'ready') {
            clearTimeout(r.timer); r.readyAt = performance.now(); r.phase = 'recording'; setPhase('recording');
            r.tick = setInterval(() => setSeconds(Math.floor((performance.now() - r.readyAt!) / 1000)), 250);
            if (r.filePcm) {
              const feed = () => {
                if (r.cancelled || r.phase !== 'recording') return;
                const end = Math.min(r.fileOffset + 9600, r.filePcm!.length);
                r.timer = setTimeout(() => {
                  sendPcm(r, r.filePcm!.slice(r.fileOffset, end)); r.fileOffset = end;
                  if (end === r.filePcm!.length) void stop(r); else feed();
                }, Math.max(0, r.readyAt! + end / 48 - performance.now()));
              }; feed();
            } else {
              r.worklet = new AudioWorkletNode(context, 'voice-comparison-recorder');
              r.worklet.port.onmessage = event => {
                if (event.data.pcm) sendPcm(r, event.data.pcm);
                if (event.data.stopped) r.flush?.();
              };
              r.inputNode = context.createMediaStreamSource(r.stream!); r.inputNode.connect(r.worklet); r.worklet.connect(context.destination);
              r.timer = setTimeout(() => void stop(r), 30000);
            }
          } else if (m.type === 'audio' && r.players[m.provider as Provider]) {
            r.players[m.provider as Provider].receive(decodePcm(m.audio)); refresh(n => n + 1);
          } else if (m.type === 'text') {
            const result = r.results[m.provider as Provider];
            result.input = m.append ? result.input + m.input : m.input;
            result.output = m.append ? result.output + m.output : m.output;
            setResults({ ...r.results });
          } else if (m.type === 'input') r.inputEvidence = { pcmSha256: m.pcmSha256, bytes: m.bytes, liveQueuedPcmSha256: m.liveQueuedPcmSha256, liveQueuedBytes: m.liveQueuedBytes };
          else if (m.type === 'done') {
            Object.assign(r.results[m.provider as Provider], { done: true, error: m.error, usageSeconds: m.usageSeconds, turnCompletionConfirmed: m.turnCompletionConfirmed });
            setResults({ ...r.results });
          } else if (m.type === 'finished') { closeInput(r); r.phase = 'finished'; setPhase('finished'); refresh(n => n + 1); }
        } catch { fail(r, '시험 응답을 처리하지 못했습니다.'); }
      };
    } catch (e) {
      fail(r, e instanceof Error && e.message === 'FILE_DURATION' ? '30초 이내의 녹음 파일을 선택해 주세요.' : '마이크 권한, 녹음 파일 또는 로그인 상태를 확인해 주세요.');
    }
  }

  function report() {
    const r = current.current; if (!r) return;
    download('voice-comparison-report.json', JSON.stringify({
      method: 'Same mono PCM24k input. Live streams during recording; Gemini receives the full WAV at stop using the existing /live pipeline. No conversation history. Playback held until microphone stops; only the selected provider is audible.',
      models: { live: 'gpt-live-1', gemini: 'gemini-3.6-flash', tts: 'gemini-3.1-flash-tts-preview' },
      source: r.source, primary: r.primary, inputMethod: r.filePcm ? 'file_realtime' : 'microphone',
      readyWaitMs: r.readyAt ? r.readyAt - r.startedAt : null, sourceDurationMs: concatPcm(r.input).length / 48,
      inputEvidence: r.inputEvidence, results: r.results,
      playback: { live: r.players.live.metrics(), gemini: r.players.gemini.metrics() },
      limits: 'Browser audio scheduling, not physical speaker latency. Thresholded signal is not proof of speech or quality. Zero queue gaps does not prove uninterrupted speech. Live uses a fixed 30-second post-stop capture window without turn completion confirmation. File/microphone PCM encoding differs from the main app MediaRecorder encoding. No automatic quality scoring.',
    }, null, 2), 'application/json');
  }
  function listen(provider: Provider) {
    const r = current.current; if (!r) return;
    stopReplay(); r.players.live.cancel(); r.players.gemini.cancel();
    const url = URL.createObjectURL(new Blob([wavBytes(concatPcm(r.players[provider].playable))], { type: 'audio/wav' }));
    const audio = new Audio(url); replay.current = audio;
    audio.onended = stopReplay; void audio.play().catch(() => setError('재생을 시작하지 못했습니다. 다시 눌러 주세요.'));
  }
  const r = current.current;
  const button = 'rounded-xl px-4 py-3 font-semibold disabled:opacity-40 bg-amber-100 text-stone-800';
  return <main className="min-h-screen bg-stone-50 text-stone-800 p-4 pb-12"><div className="max-w-2xl mx-auto space-y-5">
    <Link to="/app" className="text-sm underline">← 기존 번역 앱</Link>
    <h1 className="text-2xl font-bold">음성 번역 비교</h1>
    <p className="text-sm leading-relaxed">한 번 말하면 두 모델이 같은 녹음을 번역합니다. 스탑을 누른 뒤 선택한 음성만 먼저 들려드립니다. 기존 앱의 모델은 바뀌지 않습니다.</p>
    <div className="bg-white rounded-2xl p-4 space-y-4 border border-stone-200">
      <label className="block">말하는 언어<select aria-label="말하는 언어" disabled={busy} value={source} onChange={e => setSource(e.target.value)} className="block w-full p-3 border rounded-xl mt-1">
        <option value="ko">한국어 → 일본어</option><option value="ja">일본어 → 한국어</option>
      </select></label>
      <label className="block">먼저 들을 음성<select aria-label="먼저 들을 음성" disabled={busy} value={primary} onChange={e => setPrimary(e.target.value as Provider)} className="block w-full p-3 border rounded-xl mt-1">
        <option value="live">GPT-Live 1</option><option value="gemini">현재 Gemini</option>
      </select></label>
      <details><summary className="text-sm cursor-pointer">녹음 파일로 시험하기 (선택)</summary>
        <input aria-label="녹음 파일" type="file" accept="audio/*" disabled={busy} className="text-sm w-full mt-3" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        {file && <button disabled={busy} className="underline text-sm mt-2" onClick={() => setFile(null)}>파일 대신 마이크 사용</button>}
      </details>
      <p className="text-sm text-stone-600">5~15초 정도 말해 주세요. 최대 30초입니다. 두 API의 시험 비용이 발생하며, GPT-Live는 정지 후에도 최대 30초 동안 수신합니다.</p>
      <div className="flex flex-wrap gap-2">
        {!busy && <button className={button} onClick={() => void begin()}>{file ? '이 파일로 비교 시작' : '마이크로 비교 시작'}</button>}
        {phase === 'recording' && <button className={button + ' !bg-red-600 !text-white'} onClick={() => r && void stop(r)}>스탑 · 번역 듣기</button>}
        {busy && <button className={button} onClick={() => { cancel(r); if (r) r.phase = 'failed'; setPhase('failed'); setError('시험을 중단했습니다.'); }}>시험 중단</button>}
      </div>
      <p role="status" className="font-semibold">{phase === 'preparing' ? '연결과 마이크 준비 중… 아직 말하지 마세요.' : phase === 'recording' ? `${file ? '파일 전송' : '지금 말씀하세요'} · ${seconds}초` : phase === 'receiving' ? '마이크 꺼짐 · 번역 수신 중…' : phase === 'finished' ? '수신 종료 · 두 번역을 확인해 주세요.' : ''}</p>
      {error && <p role="alert" className="text-red-700 text-sm">{error}</p>}
    </div>
    {(['live', 'gemini'] as Provider[]).map(provider => {
      const result = results[provider], player = r?.players[provider], metrics = player?.metrics();
      const ms = metrics?.stopToScheduledSpeechMs;
      return <section key={provider} className="bg-white rounded-2xl p-4 border border-stone-200 space-y-3">
        <h2 className="text-lg font-bold">{names[provider]} {r?.primary === provider ? '· 먼저 듣기' : ''}</h2>
        <p className="text-sm">정지 → 음성 시작: <strong>{ms == null ? '측정 대기' : `${(ms / 1000).toFixed(2)}초`}</strong></p>
        <p className="text-xs text-stone-600">브라우저 재생 예약 기준{r?.primary !== provider ? ' · 이 음성은 무음으로 측정' : ''}. 실제 스피커 소리까지의 지연은 별도입니다.</p>
        {metrics?.firstSignalSample != null && <p className="text-sm">음성 구간 재생 대기: {metrics.signalSpanQueueGapsMs.length}회{!result.done ? ' (수신 중)' : ''}</p>}
        {metrics?.audioClockInterrupted && <p className="text-red-700 text-sm">오디오 시계가 멈춰 시간 측정이 불완전합니다. 다시 시험해 주세요.</p>}
        <div><h3 className="text-xs text-stone-500">받아쓴 원문</h3><p className="whitespace-pre-wrap break-words">{result.input || '—'}</p></div>
        <div><h3 className="text-xs text-stone-500">번역문</h3><p className="whitespace-pre-wrap break-words">{result.output || '—'}</p></div>
        {result.error && <p className="text-red-700 text-sm">수신 오류: {result.error}. 일부 결과일 수 있습니다.</p>}
        {result.done && !result.output && <p className="text-red-700 text-sm">번역문을 받지 못했습니다.</p>}
        {result.done && metrics?.firstSignalSample == null && <p className="text-red-700 text-sm">기준 크기 이상의 음성 신호를 찾지 못했습니다.</p>}
        {provider === 'live' && result.done && <p className="text-xs text-stone-600">정해진 수신 시간을 마쳤습니다. 문장 완결을 확인한 표시는 아닙니다.{result.usageSeconds != null ? ` API 사용 시간 ${result.usageSeconds}초.` : ' 최종 과금 시간 미확인.'}</p>}
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={busy || !player?.playable.length} onClick={() => listen(provider)}>다시 듣기</button>
          <button className={button} disabled={busy || !player?.raw.length} onClick={() => download(`${provider}-raw.wav`, wavBytes(concatPcm(player!.raw)), 'audio/wav')}>원본 음성 저장</button>
        </div>
      </section>;
    })}
    <p className="text-sm leading-relaxed text-stone-600">숫자·부정 표현·알레르기·문장 끝이 맞는지, 직접 들어 보며 확인해 주세요. 재생 대기 0회만으로 음성이 끊기지 않거나 번역 품질이 같다고 판정하지 않습니다.</p>
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || !r} onClick={report}>비교 기록 저장</button>
      <button className={button} disabled={busy || !r?.input.length} onClick={() => download('source.wav', wavBytes(concatPcm(r!.input)), 'audio/wav')}>입력 녹음 저장</button>
      <button className={button} onClick={stopReplay}>다시 듣기 중지</button></div>
    <p className="text-xs text-stone-500">소유자 전용 시험 · 녹음과 결과는 이 화면의 메모리에만 보관합니다. 저장 버튼을 누르면 기기에 내려받습니다.</p>
  </div></main>;
}

export default function VoiceComparison() {
  const { user } = useAuth();
  return <VoiceComparisonPanel getToken={() => {
    if (!user) return Promise.reject(new Error('AUTH_REQUIRED'));
    return user.getIdToken();
  }} />;
}
