import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chess } from 'chess.js';
import type { ChessPosition, ModelId } from '../../chessComparison';
import { authFetch } from '../authFetch';
import { useAuth } from '../contexts/AuthContext';
import './chessComparison.css';

type Position = ChessPosition & { reservedUsd: Record<ModelId, number> };
type Config = { revision: string; outputLimit: number; priceCheckedAt: string; positions: Position[];
  models: { id: ModelId; name: string; provider: string; configured: boolean; rate: { input: number; cached: number; output: number } }[] };
type Result = { model: ModelId; positionId: string; repeat: number; status: string; httpStatus?: number;
  answer?: Record<string, any> | null; answerText?: string; actualModel?: string; promptSha256?: string;
  latencySeconds?: number; costUsd: number | null; costUpperUsd: number | null; tokens?: { input: number; output: number; cached: number; reasoning: number };
  validation?: { checks: number; errors: string[] }; [key: string]: unknown };
type Run = { id: string; createdAt: string; revision: string; order: ModelId[]; plannedCalls: number; status: string;
  reservedUsd: number; results: Result[]; ratings: Record<string, { clarity?: number; accuracy?: number; note?: string }> };
type RequestFn = (path: string, init?: RequestInit) => Promise<Response>;
const text = (x: unknown) => typeof x === 'string' ? x : '';
const array = (x: unknown): Record<string, any>[] => Array.isArray(x) ? x.filter(v => v && typeof v === 'object' && !Array.isArray(v)) : [];
const dollars = (x: number | null | undefined) => typeof x === 'number' ? '$' + x.toFixed(4) : '미측정';
const seconds = (x: number | undefined) => typeof x === 'number' ? x.toFixed(2) + '초' : '—';
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return !s.length ? undefined : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const recordKey = (r: Result) => `${r.positionId}:${r.model}:${r.repeat}`;
const messages: Record<string, string> = {
  AUTH_REQUIRED: '번역앱에 로그인한 후 다시 열어 주세요.', OWNER_ONLY: '이 시험은 앱 소유자 계정으로만 사용할 수 있습니다.',
  MISSING_KEY: '이 모델의 API 키가 서버에 연결되지 않았습니다.', ALREADY_RUNNING: '다른 비교 요청이 진행 중입니다. 끝난 뒤 다시 실행해 주세요.',
  RUN_LIMIT: '시험 요청 한도에 도달했습니다. 잠시 후 다시 실행해 주세요.', INVALID_REQUEST: '시험 설정을 다시 확인해 주세요.', BUSY: '잠시 후 다시 시도해 주세요.',
  missing_key: '서버 키 없음', accessible: '모델 조회 성공 · 생성 전', connection_error: '연결 실패 · 비용 미확인',
  http_401: '키 인증 실패', http_403: '접근 권한 없음', http_404: '모델 조회 불가', http_429: '요청/결제 한도 확인 필요',
  completed: '해설 생성 완료', incomplete_or_invalid: '출력 잘림 또는 형식 오류', model_mismatch: '요청한 모델과 응답 모델 불일치',
  api_error: 'API 요청 실패', stopped: '현재 응답까지 받고 중단', finished: '시험 완료', interrupted: '연결 종료 · 일부 결과만 저장', running: '시험 중', finished_with_errors: '시험 종료 · 일부 응답 실패',
};
const explain = (s: string) => messages[s] ?? s;
const pieces: Record<string, string> = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const pieceNames: Record<string, string> = { k: '킹', q: '퀸', r: '룩', b: '비숍', n: '나이트', p: '폰' };

function Board({ fen, moves, step, flipped }: { fen: string; moves: string[]; step: number; flipped: boolean }) {
  let current = fen, invalid = false;
  try { const b = new Chess(fen); for (const m of moves.slice(0, step)) b.move({ from: m.slice(0, 2), to: m.slice(2, 4), ...(m[4] ? { promotion: m[4] } : {}) }); current = b.fen(); } catch { invalid = true; }
  const cells: string[] = [];
  for (const ch of current.split(' ')[0]) { if (ch === '/') continue; if (/\d/.test(ch)) cells.push(...Array(Number(ch)).fill('')); else cells.push(ch); }
  const indexes = Array.from({ length: 64 }, (_, i) => i); if (flipped) indexes.reverse();
  const last = !invalid && step > 0 ? moves[step - 1] : null;
  return <><div className="chess-board" role="img" aria-label="체스판. 흰색 말은 밝은색, 검은색 말은 어두운색입니다.">
    {indexes.map((idx, display) => { const r = Math.floor(idx / 8), f = idx % 8, sq = String.fromCharCode(97 + f) + (8 - r), p = cells[idx];
      return <div key={sq} className={`chess-square ${(r + f) % 2 ? 'dark' : 'light'} ${last && (last.slice(0, 2) === sq || last.slice(2, 4) === sq) ? 'last' : ''}`} title={`${sq} ${p ? (p === p.toUpperCase() ? '백 ' : '흑 ') + pieceNames[p.toLowerCase()] : '빈칸'}`}>
        {display % 8 === 0 && <small className="rank">{8 - r}</small>}{display >= 56 && <small className="file">{String.fromCharCode(97 + f)}</small>}
        {p && <span className={p === p.toUpperCase() ? 'white-piece' : 'black-piece'}>{pieces[p]}</span>}
      </div>; })}
  </div>{invalid && <p className="chess-error">불법 수가 포함되어 시작 위치를 표시합니다.</p>}</>;
}

function Answer({ answer: a, onLine }: { answer: Record<string, any>; onLine: (moves: string[], label: string) => void }) {
  return <div className="chess-answer-body"><p className="chess-summary">{text(a.summary)}</p>
    {([['나의 약점', 'my_weaknesses'], ['상대의 약점', 'opponent_weaknesses']] as const).map(([label, key]) => <div key={key}><h4>{label}</h4>{array(a[key]).length ? array(a[key]).map((x, i) => <p key={i}><b>{text(x.square)}</b> {text(x.reason)}</p>) : <p className="chess-muted">뚜렷하게 지목한 약점 없음</p>}</div>)}
    {([['나의 강한 말', 'my_strong_piece'], ['상대의 강한 말', 'opponent_strong_piece']] as const).map(([label, key]) => <div key={key}><h4>{label}</h4><p>{text(a[key]?.square)} {text(a[key]?.reason) || '지목하지 않음'}</p></div>)}
    <div className="chess-plan"><h4>지금 할 일</h4><p><b>{text(a.plan?.move_uci)}</b> {text(a.plan?.reason)}</p><p>다음 목표: {text(a.plan?.next_goal)}</p></div>
    {array(a.branches).map((x, i) => { const moves = Array.isArray(x.moves_uci) ? x.moves_uci.filter((m: unknown) => typeof m === 'string') : []; return <div key={i}><h4>상대 응수에 따른 흐름 {i + 1}</h4><p>{text(x.explanation)}</p><button type="button" onClick={() => onLine(moves, `해설 진행 ${i + 1}`)}>체스판에서 보기</button><small className="chess-moves">{moves.join(' → ')}</small></div>; })}
    <div><h4>다른 선택</h4><p><b>{text(a.alternative?.move_uci)}</b> {text(a.alternative?.reason)}</p></div>
    {text(a.caveat) && <p className="chess-muted">{text(a.caveat)}</p>}
  </div>;
}

export function ChessComparisonPanel({ request = authFetch, storageKey }: { request?: RequestFn; storageKey: string }) {
  const [config, setConfig] = useState<Config | null>(null), [error, setError] = useState('');
  const [selected, setSelected] = useState<ModelId[]>(['gpt-5.6-terra', 'gpt-6-astra']);
  const [positionId, setPositionId] = useState('T1'), [scope, setScope] = useState('one');
  const [repeat, setRepeat] = useState(1), [reasoning, setReasoning] = useState('medium'), [budget, setBudget] = useState(10);
  const [busy, setBusy] = useState(false), [checking, setChecking] = useState(false), [checks, setChecks] = useState<Record<string, string>>({});
  const [run, setRun] = useState<Run | null>(null), [reveal, setReveal] = useState(false), [progress, setProgress] = useState('');
  const [moves, setMoves] = useState<string[]>([]), [lineLabel, setLineLabel] = useState('시작 위치'), [step, setStep] = useState(0), [flipped, setFlipped] = useState(false);
  const stop = useRef(false), currentRun = useRef<Run | null>(null), abort = useRef<AbortController | null>(null), alive = useRef(true);
  const position = config?.positions.find(p => p.id === positionId);
  const save = (value: Run) => { currentRun.current = value; if (alive.current) setRun(value); try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* Download remains available. */ } };
  useEffect(() => {
    alive.current = true; let cancelled = false;
    request('/api/chess-benchmark/config').then(async r => { const d = await r.json(); if (!r.ok) throw Error(d.error ?? '설정을 불러오지 못했습니다.'); if (!cancelled) setConfig(d); }).catch(e => { if (!cancelled) setError(explain(e.message)); });
    try { const old = JSON.parse(localStorage.getItem(storageKey) ?? 'null'); if (old && Array.isArray(old.results) && Array.isArray(old.order) && old.ratings && typeof old.revision === 'string') { if (old.status === 'running') old.status = 'interrupted'; setRun(old); currentRun.current = old; } } catch { /* Empty or corrupt local history. */ }
    return () => { cancelled = true; alive.current = false; stop.current = true; abort.current?.abort(); };
  }, [request, storageKey]);
  useEffect(() => { setMoves([]); setStep(0); setLineLabel('시작 위치'); }, [positionId]);
  const positions = config ? scope === 'all' ? config.positions : config.positions.filter(p => p.id === positionId) : [];
  const reserve = positions.reduce((sum, p) => sum + selected.reduce((s, m) => s + p.reservedUsd[m], 0), 0) * repeat;
  const onLine = (line: string[], label: string) => { setMoves(line); setStep(0); setLineLabel(label); };
  async function checkAccess() {
    setChecking(true); setError('');
    try { const r = await request('/api/chess-benchmark/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ models: config!.models.map(m => m.id) }) }); const d = await r.json(); if (!r.ok) throw Error(d.error); setChecks(Object.fromEntries(d.checks.map((x: any) => [x.model, x.status]))); }
    catch (e) { setError(explain(e instanceof Error ? e.message : '연결 확인 실패')); } finally { setChecking(false); }
  }
  async function start() {
    if (!config || busy || selected.length === 0 || reserve > budget || budget > 10 || budget <= 0) return;
    const missing = config.models.find(m => selected.includes(m.id) && !m.configured);
    if (missing) { setError(`${missing.name}: 서버 API 키가 없습니다. 해당 모델의 선택을 해제한 뒤 시험할 수 있습니다.`); return; }
    setBusy(true); setError(''); setReveal(false); stop.current = false;
    // Randomize blind labels independently of request order. Actual model names remain in export for reproducibility.
    const order = [...selected]; for (let i = order.length - 1; i > 0; i--) { const n = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [order[i], order[n]] = [order[n], order[i]]; }
    let next: Run = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), revision: config.revision, order,
      plannedCalls: positions.length * selected.length * repeat, reservedUsd: reserve, status: 'running', results: [], ratings: {} };
    save(next); const disabled = new Set<ModelId>();
    try {
      outer: for (let round = 1; round <= repeat; round++) for (let i = 0; i < positions.length; i++) {
        const p = positions[i], offset = (i + round - 1) % selected.length, sequence = [...selected.slice(offset), ...selected.slice(0, offset)];
        for (const model of sequence) {
          if (stop.current) break outer;
          if (disabled.has(model)) continue;
          setProgress(`${next.results.length + 1}/${next.plannedCalls} · ${p.id} · ${round}회차`);
          abort.current = new AbortController();
          const response = await request('/api/chess-benchmark/run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, positionId: p.id, reasoning }), signal: abort.current.signal });
          const result = await response.json();
          if (!response.ok) throw Error(explain(result.error ?? `HTTP ${response.status}`));
          if (result.status === 'api_error' || result.status === 'model_mismatch' || result.status === 'connection_error') disabled.add(model);
          next = { ...next, results: [...next.results, { ...result, repeat: round }] }; save(next);
        }
      }
      next = { ...next, status: stop.current ? 'stopped' : next.results.some(r => r.status !== 'completed') ? 'finished_with_errors' : 'finished' }; save(next);
    } catch (e) { next = { ...next, status: 'interrupted' }; save(next); if (alive.current) setError(explain(e instanceof Error ? e.message : '요청 중단')); }
    finally { if (alive.current) { setBusy(false); setProgress(''); } abort.current = null; }
  }
  function rate(r: Result, field: 'clarity' | 'accuracy' | 'note', value: number | string) {
    const old = currentRun.current; if (!old) return; const key = recordKey(r);
    save({ ...old, ratings: { ...old.ratings, [key]: { ...old.ratings[key], [field]: value } } });
  }
  function download() {
    if (!run) return;
    const payload = { ...run, config, checks, evaluationNote: '자동 검사는 명시한 사실과 합법 수순만 확인합니다. 자유 서술의 전략적 정확성과 이해도는 수동 평가입니다.',
      timingNote: '서버에서 공급자 요청 시작~전체 응답 수신. Stockfish 사전 준비 및 브라우저 왕복 시간 제외.',
      costNote: '사용량×공식 유료 단가의 추정 범위. OpenAI 캐시 쓰기 가능성 반영. 청구서·세금·Cloud Run 비용 제외. 미확인 비용은 null.' };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `chess-comparison-${run.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (!config) return <main className="chess-lab"><Link to="/app">← 번역앱</Link><h1>체스 해설 비교</h1><p role="status">{error || '시험 설정을 불러오는 중입니다.'}</p></main>;
  const visibleResults = run?.results.filter(r => r.positionId === positionId) ?? [];
  return <main className="chess-lab">
    <header><Link to="/app">← 번역앱으로</Link><span className="chess-pill">소유자 전용 시험</span><h1>같은 판, 다른 설명</h1><p>강한 말과 약점, 지금 둘 수와 그다음 흐름을 비교합니다.</p></header>
    <section className="chess-card chess-settings" aria-label="시험 설정"><div className="chess-section-head"><h2>비교할 모델</h2><button onClick={checkAccess} disabled={checking || busy}>{checking ? '확인 중…' : 'API 인증 확인'}</button></div>
      <div className="chess-model-options">{config.models.map(m => <label key={m.id}><input type="checkbox" checked={selected.includes(m.id)} disabled={busy} onChange={() => setSelected(selected.includes(m.id) ? selected.filter(x => x !== m.id) : [...selected, m.id])} /><span><b>{m.name}</b><small>{checks[m.id] ? explain(checks[m.id]) : m.configured ? '서버 키 연결됨 · 호출 전' : '서버 키 없음'}</small></span></label>)}</div>
      <div className="chess-options"><label>시험 범위<select value={scope} disabled={busy} onChange={e => setScope(e.target.value)}><option value="one">현재 국면</option><option value="all">12개 국면 전체</option></select></label>
        <label>반복 횟수<select value={repeat} disabled={busy} onChange={e => setRepeat(Number(e.target.value))}>{[1, 2, 3].map(n => <option key={n} value={n}>{n}회</option>)}</select></label>
        <label>OpenAI 추론<select value={reasoning} disabled={busy} onChange={e => setReasoning(e.target.value)}><option value="low">낮음 · low</option><option value="medium">보통 · medium</option><option value="high">높음 · high</option></select></label>
        <label>이번 시험 예산(USD)<input type="number" min=".1" max="10" step=".1" value={budget} disabled={busy} onChange={e => setBudget(Number(e.target.value))} /></label></div>
      <p className="chess-muted">예정 {positions.length * selected.length * repeat}회 · 보수적으로 잡은 API 비용 상한 {dollars(reserve)}. 실제 사용량으로 결과를 계산합니다.</p>
      {reserve > budget && <p className="chess-error">선택한 시험의 예상 상한이 예산보다 큽니다. 범위·모델·반복 횟수를 줄여 주세요.</p>}
      <div className="chess-actions"><button className="chess-primary" onClick={start} disabled={busy || checking || !selected.length || reserve > budget || budget <= 0 || budget > 10}>{busy ? '해설 비교 중…' : '선택한 조건으로 비교 시작'}</button>
        {busy && <button onClick={() => { stop.current = true; setProgress('현재 응답을 받은 뒤 중단합니다.'); }}>현재 응답 후 중단</button>}
        {run && <button onClick={download}>결과 JSON 내려받기</button>}</div>
      <p role="status" className="chess-muted">{progress || (run ? `${run.results.length}/${run.plannedCalls}회 기록 · ${explain(run.status)}` : '버튼을 누르기 전에는 유료 해설을 생성하지 않습니다.')}</p>
      {error && <p className="chess-error" role="alert">{error}</p>}
    </section>
    <div className="chess-layout"><section className="chess-card chess-position"><label>검토할 국면<select value={positionId} onChange={e => setPositionId(e.target.value)}>{config.positions.map(p => <option key={p.id} value={p.id}>{p.id} · {p.title}</option>)}</select></label>
      {position && <><div className="chess-tags"><span>{position.category}</span><span>{position.context.side_to_move === 'white' ? '백' : '흑'} 차례</span></div>
        <Board fen={position.fen} moves={moves} step={step} flipped={flipped} />
        <div className="chess-board-controls"><button disabled={step === 0} onClick={() => setStep(step - 1)}>← 이전</button><button disabled={step >= moves.length} onClick={() => setStep(step + 1)}>다음 수 →</button><button onClick={() => setStep(0)}>처음</button><button onClick={() => setFlipped(!flipped)}>뒤집기</button></div>
        <p className="chess-moves">{lineLabel} · {step}/{moves.length}수<br />{moves.slice(0, step).join(' → ') || '처음 위치'}</p>
        <details><summary>Stockfish 기준 수순</summary>{position.context.engine_lines.map((l, i) => <button className="chess-engine-line" key={i} onClick={() => onLine(l.moves_uci, `엔진 후보 ${i + 1}`)}>{i + 1}. {l.moves_san[0]} · 백 기준 {l.mate_white != null ? `메이트 ${l.mate_white}` : (Number(l.score_white_cp) / 100).toFixed(2)}</button>)}<p className="chess-muted">이 수순은 가능한 진행 예시이며, 상대의 선택이 강제된다는 뜻은 아닙니다.</p></details>
        {position.context.exact_tablebase && <p className="chess-tablebase">테이블베이스: 최선 대응 시 {position.context.exact_tablebase.category_side_to_move === 'draw' ? '무승부' : position.context.exact_tablebase.category_side_to_move}</p>}
        <details><summary>국면 출처·동일 입력 확인</summary><p>{position.source_note}</p><code>{position.fen}</code><p className="chess-muted">프롬프트 SHA256<br /><code>{position.prompt_sha256}</code></p></details></>}
    </section>
    <section className="chess-results"><div className="chess-section-head"><h2>해설 읽어보기</h2><button onClick={() => setReveal(!reveal)}>{reveal ? '모델명 가리기' : '모델명·시간·비용 보기'}</button></div>
      {!visibleResults.length && <div className="chess-card chess-empty"><b>아직 이 국면의 해설이 없습니다.</b><p>비교를 시작하면 같은 입력을 받은 모델들의 답변이 여기에 나타납니다.</p></div>}
      {(run?.order ?? []).flatMap((model, labelIndex) => visibleResults.filter(r => r.model === model).map(r => <article className="chess-card chess-answer" key={recordKey(r)}>
        <div className="chess-section-head"><h3>{reveal ? config.models.find(m => m.id === model)?.name : `해설 ${String.fromCharCode(65 + labelIndex)}`} <small>{r.repeat}회차</small></h3><span className={r.status === 'completed' ? 'chess-ok' : 'chess-error'}>{explain(r.status)}{r.httpStatus ? ` (${r.httpStatus})` : ''}</span></div>
        {reveal && <p className="chess-metrics">{seconds(r.latencySeconds)} · 비용 {dollars(r.costUsd)}{r.costUpperUsd != null && r.costUpperUsd !== r.costUsd ? `~${dollars(r.costUpperUsd)}` : ''}<br /><small>{r.actualModel || model} {r.tokens ? `· 입력 ${r.tokens.input} / 출력·추론 ${r.tokens.output} 토큰` : ''}</small></p>}
        {r.answer ? <Answer answer={r.answer} onLine={onLine} /> : <p>{r.answerText || '해설을 받지 못했습니다. 인증 확인 또는 오류 상태를 확인해 주세요.'}</p>}
        {r.validation && <details className={r.validation.errors.length ? 'chess-error' : ''}><summary>자동 사실·수순 검사: 오류 {r.validation.errors.length}개 / 검사 {r.validation.checks}개</summary>{r.validation.errors.map((e, i) => <p key={i}>{e}</p>)}<p>오류 0개여도 설명 전체의 정확성을 보장하지 않습니다. 전략적 이유는 별도 검토가 필요합니다.</p></details>}
        {r.answer && <div className="chess-ratings">{(['clarity', 'accuracy'] as const).map(field => <fieldset disabled={busy} key={field}><legend>{field === 'clarity' ? '이해하기 쉬운 정도' : '설명 정확성 · 직접 검토한 경우'}</legend>{[1, 2, 3, 4, 5].map(n => <button key={n} aria-pressed={run?.ratings[recordKey(r)]?.[field] === n} onClick={() => rate(r, field, n)}>{n}</button>)}</fieldset>)}<textarea aria-label="이 해설의 평가 메모" disabled={busy} placeholder="어떤 설명이 이해됐는지, 어떤 부분이 이상했는지 메모" value={run?.ratings[recordKey(r)]?.note ?? ''} onChange={e => rate(r, 'note', e.target.value)} /></div>}
      </article>))}
    </section></div>
    {run && reveal && <section className="chess-card chess-summary-table"><h2>이번 시험 요약</h2><div className="chess-table-scroll"><table><thead><tr><th>모델</th><th>완료 / 시도</th><th>완료 시간 중앙값</th><th>자동 오류가 있는 답변</th><th>이해도 평균</th><th>비용 합계 범위</th></tr></thead><tbody>{run.order.map(id => {
      const all = run.results.filter(r => r.model === id), ok = all.filter(r => r.status === 'completed');
      const quality = ok.map(r => run.ratings[recordKey(r)]?.clarity).filter((x): x is number => typeof x === 'number');
      const unknown = all.some(r => r.costUsd == null), known = all.filter(r => r.costUsd != null);
      return <tr key={id}><td>{config.models.find(m => m.id === id)?.name}</td><td>{ok.length} / {all.length}</td><td>{seconds(median(ok.flatMap(r => typeof r.latencySeconds === 'number' ? [r.latencySeconds] : [])))}</td><td>{ok.filter(r => r.validation?.errors.length).length} / {ok.length}</td><td>{quality.length ? (quality.reduce((a, b) => a + b, 0) / quality.length).toFixed(1) + ` (${quality.length}개)` : '평가 전'}</td><td>{known.length ? `${dollars(known.reduce((s, r) => s + r.costUsd!, 0))}~${dollars(known.reduce((s, r) => s + r.costUpperUsd!, 0))}` : '미측정'}{unknown && ' + 미확인 비용'}</td></tr>; })}</tbody></table></div></section>}
    <footer className="chess-card"><h2>결과를 읽는 기준</h2><p>정확성은 기물·공격·핀·합법 수순 자동 검사와 설명 검토를 함께 봅니다. 이해도는 1점(이해하기 어려움)~5점(다음 행동과 이유를 설명할 수 있음)으로 직접 평가하세요.</p><p>응답시간은 서버 요청부터 전체 답변 수신까지입니다. 동일 프롬프트와 출력 상한 {config.outputLimit}토큰을 사용하지만 내부 추론량은 같지 않습니다. Gemini는 기본 추론 설정을 사용합니다. 실패한 모델은 같은 시험에서 자동 재시도하지 않습니다.</p><p>비용은 실제 반환 사용량에 공식 유료 단가를 적용한 추정 범위이며 청구서와 다를 수 있습니다. 캐시 쓰기 가능성을 반영하고, 세금·Cloud Run 비용은 제외합니다. 12개 구성 국면은 작은 예비 비교 자료입니다.</p><p>결과와 평가는 이 브라우저에 마지막 시험만 저장됩니다. 보관하거나 검토를 맡기려면 JSON을 내려받으세요.</p><small>{config.revision} · 단가 확인 {config.priceCheckedAt} · <a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noreferrer">OpenAI 단가</a> · <a href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noreferrer">Gemini 단가</a></small></footer>
  </main>;
}
export default function ChessComparison() {
  const { user } = useAuth();
  return <ChessComparisonPanel storageKey={`chess-benchmark:last:${user?.uid ?? 'owner'}`} />;
}
