import { Chess, SQUARES, type Square } from 'chess.js';

export const pieceNames: Record<string, string> = { k: '킹', q: '퀸', r: '룩', b: '비숍', n: '나이트', p: '폰' };
export const isSquare = (v: unknown): v is Square => typeof v === 'string' && /^[a-h][1-8]$/.test(v);
export const isMove = (v: unknown): v is string => typeof v === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(v);
const moveObject = (m: string) => ({ from: m.slice(0, 2), to: m.slice(2, 4), ...(m[4] ? { promotion: m[4] } : {}) });
export type Mark = { square: Square; kind: 'my-strong' | 'their-strong' | 'my-weak' | 'their-weak'; label: string; symbol: string; reason: string };
export type Arrow = { from: Square; to: Square; kind: 'mine' | 'theirs' | 'defend' | 'move' | 'reply' };
export type DiagramRequest = { square?: string; line?: string[]; label?: string };

export function squareCenter(square: Square, flipped = false) {
  const x = square.charCodeAt(0) - 97, y = 8 - Number(square[1]);
  return { x: (flipped ? 7 - x : x) * 100 + 50, y: (flipped ? 7 - y : y) * 100 + 50 };
}
export function arrowPoints(from: Square, to: Square, knight: boolean, flipped = false) {
  const a = squareCenter(from, flipped), b = squareCenter(to, flipped);
  const points = [a];
  if (knight) points.push(Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y });
  points.push(b);
  return points.map(p => `${p.x},${p.y}`).join(' ');
}
export function boardAt(fen: string, moves: string[], step: number) {
  const board = new Chess(fen); let applied = 0, invalid = false;
  for (const move of moves.slice(0, step)) {
    try { if (!isMove(move)) throw Error(); board.move(moveObject(move)); applied++; }
    catch { invalid = true; break; }
  }
  return { board, applied, invalid, last: applied ? moves[applied - 1] : null };
}
export function moveDescription(fen: string, uci: unknown) {
  if (!isMove(uci)) return '추천수 확인 필요';
  const board = new Chess(fen);
  try {
    const m = board.move(moveObject(uci));
    if (m.isKingsideCastle()) return '킹 쪽 캐슬링';
    if (m.isQueensideCastle()) return '퀸 쪽 캐슬링';
    return `${pieceNames[m.piece]}${m.captured ? `로 상대 ${pieceNames[m.captured]} 잡기` : ' 이동'}${m.promotion ? ` · ${pieceNames[m.promotion]} 승격` : ''}${m.san.endsWith('#') ? ' · 체크메이트' : m.san.endsWith('+') ? ' · 체크' : ''} (${m.from} → ${m.to})`;
  } catch { return `둘 수 없는 수 (${uci.slice(0, 2)} → ${uci.slice(2, 4)})`; }
}
export function marksFor(fen: string, answer: Record<string, any>): Mark[] {
  const board = new Chess(fen), marks: Mark[] = [];
  for (const [key, mine, kind, label, symbol] of [
    ['my_strong_piece', true, 'my-strong', '내 강한 말', '★'],
    ['opponent_strong_piece', false, 'their-strong', '상대 강한 말', '◆'],
  ] as const) {
    const v = answer[key], p = isSquare(v?.square) ? board.get(v.square) : undefined;
    if (p && (p.color === board.turn()) === mine && (p.color === 'w' ? p.type.toUpperCase() : p.type) === v.piece)
      marks.push({ square: v.square, kind, label, symbol, reason: typeof v.reason === 'string' ? v.reason : '' });
  }
  for (const [key, kind, label, symbol] of [
    ['my_weaknesses', 'my-weak', '내 약점', '!'], ['opponent_weaknesses', 'their-weak', '상대 약점', '◎'],
  ] as const) for (const v of Array.isArray(answer[key]) ? answer[key].slice(0, 2) : []) {
    if (isSquare(v?.square)) marks.push({ square: v.square, kind, label, symbol, reason: typeof v.reason === 'string' ? v.reason : '' });
  }
  return marks;
}
export function pieceLabel(board: Chess, square: Square, mine = board.turn()) {
  const p = board.get(square);
  return p ? `${p.color === mine ? '내' : '상대'} ${pieceNames[p.type]}` : '빈칸';
}
// Geometric control, including defended friendly pieces and pinned attackers.
// This is deliberately not a list of legal moves.
export function relationsFor(board: Chess, square: Square, mine = board.turn()) {
  const p = board.get(square), arrows: Arrow[] = [], controlled: Square[] = [];
  if (!p) return { arrows, controlled };
  for (const to of SQUARES) {
    if (!board.attackers(to, p.color).includes(square)) continue;
    const target = board.get(to);
    if (!target) controlled.push(to);
    else arrows.push({ from: square, to, kind: target.color === p.color ? 'defend' : p.color === mine ? 'mine' : 'theirs' });
  }
  for (const from of board.attackers(square, p.color === 'w' ? 'b' : 'w'))
    arrows.push({ from, to: square, kind: p.color === mine ? 'theirs' : 'mine' });
  return { arrows, controlled };
}
export function invalidAttackClaims(fen: string, answer: Record<string, any>) {
  const board = new Chess(fen);
  return (Array.isArray(answer.claims) ? answer.claims : []).filter(c => {
    if (c?.kind !== 'attacks') return false;
    if (!isSquare(c.from) || !isSquare(c.to)) return true;
    const p = board.get(c.from);
    return !p || !board.attackers(c.to, p.color).includes(c.from);
  }).length;
}
export function nextMoveArrow(board: Chess, move: unknown, mine: 'w' | 'b'): Arrow | null {
  if (!isMove(move)) return null;
  try { const next = new Chess(board.fen()); const m = next.move(moveObject(move));
    return { from: m.from, to: m.to, kind: m.color === mine ? 'move' : 'reply' };
  } catch { return null; }
}
