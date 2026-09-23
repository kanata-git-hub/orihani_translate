import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { POSITIONS, MODELS, parseGeneration } from '../chessComparison.ts';
import { arrowPoints, boardAt, invalidAttackClaims, marksFor, moveDescription, nextMoveArrow, relationsFor, squareCenter } from '../src/pages/chessVisuals.ts';
const t1 = POSITIONS.find(p => p.id === 'T1')!;

test('new models keep exact API identities and their own Standard rates', () => {
  for (const [id, input, cache, output] of [['gpt-6-sol', 2, .2, 10], ['gpt-6-luna', .1, .01, .5]] as const) {
    const model = MODELS.find(m => m.id === id)!;
    const result = parseGeneration(model, { model: id, status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }],
      usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 100 }, output_tokens: 300 } });
    assert.equal(result.status, 'completed'); assert.equal(result.actualModel, id);
    assert.equal(result.costUsd, (900 * input + 100 * cache + 300 * output) / 1e6);
  }
});

test('T1 blocks the false bishop attack and future knight fork until the move is made', () => {
  const b = new Chess(t1.fen);
  const bishop = relationsFor(b, 'c4');
  assert.ok(bishop.arrows.some(a => a.to === 'd5'));
  assert.ok(!bishop.arrows.some(a => a.to === 'f7'));
  const knight = relationsFor(b, 'g5');
  assert.ok(knight.arrows.some(a => a.from === 'd8' && a.to === 'g5' && a.kind === 'theirs'));
  assert.ok(!knight.arrows.some(a => a.from === 'g5' && ['d8', 'h8'].includes(a.to)));
  assert.equal(invalidAttackClaims(t1.fen, { claims: [
    { kind: 'attacks', from: 'g5', to: 'd8' }, { kind: 'attacks', from: 'g5', to: 'h8' }, { kind: 'attacks', from: 'c4', to: 'f7' },
    { kind: 'attacks', from: 'd8', to: 'g5' },
  ] }), 3);
  const moved = boardAt(t1.fen, ['g5f7'], 1).board;
  const fork = relationsFor(moved, 'f7', 'w');
  assert.ok(fork.arrows.some(a => a.from === 'f7' && a.to === 'd8' && a.kind === 'mine'));
  assert.ok(fork.arrows.some(a => a.from === 'f7' && a.to === 'h8' && a.kind === 'mine'));
});

test('a pawn controls diagonals, not its forward movement square; pins cannot become illegal animation', () => {
  const start = new Chess();
  assert.deepEqual(relationsFor(start, 'e2').controlled.sort(), ['d3', 'f3']);
  const p = POSITIONS.find(p => p.id === 'T3')!;
  const board = new Chess(p.fen);
  assert.ok(relationsFor(board, 'c6').arrows.some(a => a.to === 'd4' && a.kind === 'defend'));
  const afterCapture = boardAt(p.fen, ['d1d4'], 1).board;
  assert.equal(nextMoveArrow(afterCapture, 'c6d4', 'w'), null);
  const stopped = boardAt(p.fen, ['d1d4', 'c6d4'], 2);
  assert.equal(stopped.invalid, true); assert.equal(stopped.applied, 1); assert.equal(stopped.board.fen(), afterCapture.fen());
});

test('flipped square centers and knight bends match the displayed board', () => {
  assert.deepEqual(squareCenter('a8'), { x: 50, y: 50 });
  assert.deepEqual(squareCenter('a8', true), { x: 750, y: 750 });
  assert.deepEqual(squareCenter('h1', true), { x: 50, y: 50 });
  assert.equal(arrowPoints('g5', 'f7', true), '650,350 650,150 550,150');
  assert.equal(arrowPoints('g5', 'f7', true, true), '150,450 150,650 250,650');
  assert.equal(arrowPoints('c4', 'd5', false), '250,450 350,350');
});

test('strength and weakness can coexist; wrong colors, absent pieces, malformed squares are not trusted', () => {
  const marks = marksFor(t1.fen, { my_strong_piece: { square: 'g5', piece: 'N', reason: '전술' }, opponent_strong_piece: { square: 'g5', piece: 'N' },
    my_weaknesses: [{ square: 'g5', reason: '공격받음' }, null], opponent_weaknesses: [{ square: '<script>' }] });
  assert.deepEqual(marks.map(m => [m.square, m.kind]), [['g5', 'my-strong'], ['g5', 'my-weak']]);
  assert.equal(marksFor(t1.fen, { my_strong_piece: { square: 'd3', piece: 'B' } }).length, 0);
  assert.equal(invalidAttackClaims(t1.fen, { claims: [null, { kind: 'attacks', from: 'a99', to: 'e1' }] }), 1);
  const black = boardAt(t1.fen, ['g5f7'], 1).board;
  assert.equal(marksFor(black.fen(), { my_strong_piece: { square: 'd5', piece: 'n' } })[0]?.kind, 'my-strong');
});

test('move captions describe captures, castles and promotion without changing the move', () => {
  assert.equal(moveDescription(t1.fen, 'g5f7'), '나이트로 상대 폰 잡기 (g5 → f7)');
  assert.equal(moveDescription(t1.fen, 'e1g1'), '킹 쪽 캐슬링');
  assert.match(moveDescription(t1.fen, 'c4f7'), /둘 수 없는 수/);
  assert.match(moveDescription('7k/P7/8/8/8/8/8/7K w - - 0 1', 'a7a8q'), /퀸 승격 · 체크/);
  assert.equal(nextMoveArrow(new Chess(t1.fen), 'g5f7', 'w')?.kind, 'move');
  assert.equal(nextMoveArrow(boardAt(t1.fen, ['g5f7'], 1).board, 'e8f7', 'w')?.kind, 'reply');
});
