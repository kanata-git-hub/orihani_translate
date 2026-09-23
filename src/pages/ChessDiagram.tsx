import { useEffect, useId, useState } from 'react';
import { Chess, SQUARES, type Square } from 'chess.js';
import { arrowPoints, boardAt, invalidAttackClaims, isSquare, marksFor, moveDescription, nextMoveArrow, pieceLabel, pieceNames, relationsFor, type Arrow, type DiagramRequest, type Mark } from './chessVisuals';

const glyphs: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const colors: Record<Arrow['kind'], string> = { mine: '#087aa0', theirs: '#c63f42', defend: '#7456b5', move: '#137a50', reply: '#c63f42' };
const kinds = [
  { kind: 'my-strong', symbol: '★', label: '내 강한 말' }, { kind: 'their-strong', symbol: '◆', label: '상대 강한 말' },
  { kind: 'my-weak', symbol: '!', label: '내 약점' }, { kind: 'their-weak', symbol: '◎', label: '상대 약점' },
] as const;

export function DiagramBoard({ board, flipped, marks = [], arrows = [], controlled = [], selected, onSelect, last }: {
  board: Chess; flipped: boolean; marks?: Mark[]; arrows?: Arrow[]; controlled?: Square[];
  selected?: Square | null; onSelect?: (square: Square) => void; last?: string | null;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const squares = flipped ? [...SQUARES].reverse() : SQUARES;
  return <div className="chess-map-board" role="group" aria-label="체스판. 말을 누르면 공격 방향을 확인할 수 있습니다.">
    <div className="chess-board">
      {squares.map((square, i) => {
        const p = board.get(square), tags = marks.filter(m => m.square === square);
        const label = `${square} ${p ? (p.color === 'w' ? '백 ' : '흑 ') + pieceNames[p.type] : '빈칸'}${tags.length ? ' · ' + tags.map(t => t.label).join(' · ') : ''}`;
        return <button type="button" key={square} aria-label={label} aria-pressed={selected === square} title={label}
          onClick={() => onSelect?.(square)} disabled={!onSelect}
          className={`chess-square ${(Math.floor(i / 8) + i % 8) % 2 ? 'dark' : 'light'} ${selected === square ? 'map-selected' : ''} ${last && (last.slice(0, 2) === square || last.slice(2, 4) === square) ? 'last' : ''}`}>
          {i % 8 === 0 && <small className="rank">{square[1]}</small>}{i >= 56 && <small className="file">{square[0]}</small>}
          {controlled.includes(square) && <span className="chess-control-dot" aria-hidden="true" />}
          {p && <span className={p.color === 'w' ? 'white-piece' : 'black-piece'} aria-hidden="true">{glyphs[p.type]}</span>}
          <span className="chess-map-badges" aria-hidden="true">{tags.map((m, n) => <span key={n} className={`chess-mark ${m.kind}`}>{m.symbol}</span>)}</span>
        </button>;
      })}
    </div>
    <svg className="chess-arrows" viewBox="0 0 800 800" aria-hidden="true">
      <defs>{Object.entries(colors).map(([kind, color]) => <marker key={kind} id={`${id}-${kind}`} markerUnits="userSpaceOnUse" markerWidth="30" markerHeight="28" refX="27" refY="14" orient="auto"><path d="M0,0 L28,14 L0,28 Z" fill={color} /></marker>)}</defs>
      {arrows.map((a, i) => <polyline key={`${a.from}-${a.to}-${i}`} points={arrowPoints(a.from, a.to, board.get(a.from)?.type === 'n', flipped)}
        fill="none" stroke={colors[a.kind]} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" strokeOpacity=".85"
        strokeDasharray={a.kind === 'defend' ? '13 12' : undefined} markerEnd={`url(#${id}-${a.kind})`} />)}
    </svg>
  </div>;
}

export function PositionBoard({ fen, moves, step, flipped }: { fen: string; moves: string[]; step: number; flipped: boolean }) {
  const { board, invalid, last } = boardAt(fen, moves, step);
  return <><DiagramBoard board={board} flipped={flipped} last={last} />{invalid && <p className="chess-error">불법 수 직전의 위치까지만 표시합니다.</p>}</>;
}

export default function ChessDiagram({ fen, answer, request }: { fen: string; answer: Record<string, any>; request?: DiagramRequest | null }) {
  const [mode, setMode] = useState<'marks' | 'attacks' | 'plan'>('marks');
  const [selected, setSelected] = useState<Square | null>(null), [flipped, setFlipped] = useState(false);
  const [step, setStep] = useState(0), [branch, setBranch] = useState(-1);
  const [customLine, setCustomLine] = useState<string[] | null>(null), [customLabel, setCustomLabel] = useState('');
  useEffect(() => { setMode('marks'); setStep(0); setSelected(null); setBranch(-1); setCustomLine(null); }, [fen, answer]);
  useEffect(() => {
    if (request?.line) { setCustomLine(request.line); setCustomLabel(request.label ?? '해설 진행'); setStep(0); setSelected(null); setMode('plan'); }
    else if (isSquare(request?.square)) { setSelected(request.square); setStep(0); setMode('marks'); }
  }, [request]);
  const origin = new Chess(fen), mine = origin.turn();
  const marks = marksFor(fen, answer), invalidClaims = invalidAttackClaims(fen, answer);
  const branches = Array.isArray(answer.branches) ? answer.branches.slice(0, 2) : [];
  const candidate = customLine ?? (branch === -1 ? [answer.plan?.move_uci] : branches[branch]?.moves_uci);
  const line: string[] = Array.isArray(candidate) ? candidate : [];
  const { board, invalid, last } = boardAt(fen, mode === 'plan' ? line : [], mode === 'plan' ? step : 0);
  const next = mode === 'plan' && !invalid ? nextMoveArrow(board, line[step], mine) : null;
  const nextInvalid = mode === 'plan' && step < line.length && !next;
  const focus = selected ?? (mode === 'attacks' ? marks.find(m => m.kind === 'my-strong')?.square ?? null : null);
  const relation = focus ? relationsFor(board, focus, mine) : { arrows: [], controlled: [] };
  const arrows = mode === 'plan' ? next ? [next] : [] : mode === 'attacks' ? relation.arrows : [];
  const visibleMarks = mode === 'plan' && step > 0 ? [] : marks;
  const focusMarks = focus ? visibleMarks.filter(m => m.square === focus) : [];
  function switchMode(nextMode: typeof mode) { setMode(nextMode); setStep(0); }
  return <section className="chess-diagram" aria-label="이 해설의 체스판 시각화">
    <div className="chess-map-heading"><b>체스판으로 이해하기</b><button type="button" onClick={() => setFlipped(!flipped)}>판 뒤집기</button></div>
    <div className="chess-map-tabs" aria-label="체스판 표시 선택">
      <button type="button" aria-pressed={mode === 'marks'} onClick={() => switchMode('marks')}>강점·약점</button>
      <button type="button" aria-pressed={mode === 'attacks'} onClick={() => switchMode('attacks')}>공격 방향</button>
      <button type="button" aria-pressed={mode === 'plan'} onClick={() => switchMode('plan')}>추천수·진행</button>
    </div>
    <p className="chess-map-hint">{mode === 'marks' ? '표식이나 아래 항목을 누르면 그 말의 강점·약점을 설명합니다.' : mode === 'attacks' ? '말을 누르면 공격하는 대상과 그 말을 노리는 상대가 보입니다.' : '화살표는 다음 수입니다. 다음 수 버튼으로 한 수씩 따라가세요.'}</p>
    <DiagramBoard board={board} flipped={flipped} marks={visibleMarks} arrows={arrows}
      controlled={mode === 'attacks' ? relation.controlled : []} selected={focus} onSelect={setSelected} last={mode === 'plan' ? last : null} />
    {mode === 'marks' && <>
      <p className="chess-muted">강점·약점은 이 모델이 고른 판단입니다.</p>
      <div className="chess-map-legend">{kinds.map(k => <div key={k.kind}><b><span className={`chess-mark ${k.kind}`}>{k.symbol}</span> {k.label}</b>
        {marks.filter(m => m.kind === k.kind).length ? marks.filter(m => m.kind === k.kind).map((m, i) => <button type="button" key={i} aria-pressed={selected === m.square} onClick={() => setSelected(m.square)}>{pieceLabel(origin, m.square, mine)} <small>{m.square}</small></button>) : <span className="chess-muted">지목 없음</span>}
      </div>)}</div>
    </>}
    {mode === 'attacks' && <>
      <div className="chess-arrow-legend"><span className="mine">→ 내 공격</span><span className="theirs">→ 상대 공격</span><span className="defend">⇢ 같은 편 보호</span><span>● 빈칸 공격 범위</span></div>
      <p className="chess-muted">현재 보드로 계산한 공격 범위입니다. 폰의 전진이나 핀에 묶인 말의 실제 이동 가능성과는 다릅니다.</p>
      {!focus && <p className="chess-muted">확인할 말을 하나 눌러 주세요.</p>}
    </>}
    {mode === 'plan' && <>
      <label className="chess-line-select">따라갈 진행<select value={customLine ? 'custom' : branch} onChange={e => { setCustomLine(null); setBranch(Number(e.target.value)); setStep(0); setSelected(null); }}>
        <option value={-1}>추천수 한 수</option>{branches.map((_, i) => <option key={i} value={i}>상대 응수 {i + 1}</option>)}{customLine && <option value="custom">{customLabel}</option>}
      </select></label>
      <div className="chess-board-controls"><button type="button" disabled={step === 0} onClick={() => { setStep(step - 1); setSelected(null); }}>← 이전</button><button type="button" disabled={!next || invalid} onClick={() => { setStep(step + 1); setSelected(null); }}>다음 수 →</button><button type="button" onClick={() => { setStep(0); setSelected(null); }}>처음</button><span>{step}/{line.length}수</span></div>
      <p className="chess-next-move" role="status">{next ? `${board.turn() === mine ? '내 차례' : '상대 차례'} · ${moveDescription(board.fen(), line[step])}` : nextInvalid || invalid ? '둘 수 없는 수가 있어 여기서 진행을 멈춥니다.' : '이 진행의 마지막 위치입니다.'}</p>
      <p className="chess-muted">초록 화살표는 내 이동, 빨강은 상대 이동입니다. 나이트는 꺾인 화살표로 표시합니다.</p>
      {mode === 'plan' && step > 0 && <p className="chess-muted">시작 위치의 강점·약점 표식은 수를 진행하는 동안 숨깁니다.</p>}
    </>}
    {focus && mode !== 'plan' && <div className="chess-square-detail" role="status"><b>{pieceLabel(board, focus, mine)} · {focus}</b>
      {focusMarks.map((m, i) => <p key={i}><span className={`chess-mark ${m.kind}`}>{m.symbol}</span> {m.reason}</p>)}
      {mode === 'marks' && <button type="button" onClick={() => setMode('attacks')}>이 말의 공격 방향 보기</button>}
      {mode === 'attacks' && <><p>{relation.arrows.length ? relation.arrows.map(a => `${pieceNames[board.get(a.from)?.type ?? ''] ?? '말'}(${a.from}) → ${pieceNames[board.get(a.to)?.type ?? ''] ?? '말'}(${a.to})${a.kind === 'defend' ? ' 보호' : ' 공격'}`).join(' · ') : '이 말과 연결된 기물 간 공격·보호 화살표가 없습니다.'}</p><small>나이트의 꺾인 선은 이동 모양이며 중간 칸은 공격하지 않습니다.</small></>}
    </div>}
    {invalidClaims > 0 && <p className="chess-error">해설의 공격 주장 {invalidClaims}개가 현재 보드와 맞지 않습니다. 공격 화살표는 보드의 실제 관계로 표시합니다.</p>}
  </section>;
}
