// Isolated, owner-only chess benchmark. Existing translation routes do not use this module.
import express from 'express';
import type { Express, RequestHandler } from 'express';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Chess } from 'chess.js';
import { verifyComparisonOwner } from './voiceComparison.ts';

export const CHESS_REVISION = 'chess-pilot-2026-09-22-v1';
export const OUTPUT_LIMIT = 4096;
export const MODELS = [
  { id: 'gpt-5.6-terra', name: 'Terra', provider: 'openai', input: 2, cached: .2, output: 12 },
  { id: 'gpt-6-astra', name: 'Astra', provider: 'openai', input: 10, cached: 1, output: 50 },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'google', input: .75, cached: .075, output: 3.75 },
  { id: 'gpt-6-sol', name: 'GPT-6 Sol', provider: 'openai', input: 2, cached: .2, output: 10 },
  { id: 'gpt-6-luna', name: 'GPT-6 Luna', provider: 'openai', input: .1, cached: .01, output: .5 },
] as const;
export type ModelId = typeof MODELS[number]['id'];
type Model = typeof MODELS[number];
export type ChessPosition = { id: string; title: string; category: string; fen: string; source_note: string;
  prompt: string; prompt_sha256: string; context: { side_to_move: string; pieces: Array<{ square: string; piece: string; attacks: string[]; absolutely_pinned: boolean }>;
  legal_moves_uci: string[]; engine_lines: Array<{ moves_uci: string[]; moves_san: string[]; score_white_cp: number | null; mate_white: number | null; depth: number }>;
  exact_tablebase?: { category_side_to_move: string }; [key: string]: unknown } };
const reference = JSON.parse(readFileSync(new URL('./chess-benchmark/reference.json', import.meta.url), 'utf8'));
export const POSITIONS: ChessPosition[] = reference.positions;
for (const p of POSITIONS) {
  if (createHash('sha256').update(p.prompt).digest('hex') !== p.prompt_sha256) throw Error('CHESS_REFERENCE_INTEGRITY');
}
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const square = (s: unknown): s is string => typeof s === 'string' && /^[a-h][1-8]$/.test(s);
const uci = (s: unknown): s is string => typeof s === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(s);
const moveObject = (s: string) => ({ from: s.slice(0, 2), to: s.slice(2, 4), ...(s[4] ? { promotion: s[4] } : {}) });

export function validateAnswer(p: ChessPosition, a: unknown) {
  const errors: string[] = []; let checks = 0;
  const check = (ok: boolean, message: string) => { checks++; if (!ok) errors.push(message); };
  if (!object(a)) return { checks: 0, errors: ['JSON 객체 형식의 해설이 없습니다.'], proseReview: 'pending' };
  for (const key of ['summary', 'caveat']) check(typeof a[key] === 'string', `${key}: 설명 형식 누락`);
  for (const key of ['my_weaknesses', 'opponent_weaknesses']) {
    check(Array.isArray(a[key]) && a[key].length <= 2, `${key}: 형식 오류`);
    for (const item of Array.isArray(a[key]) ? a[key] : []) check(object(item) && square(item.square) && typeof item.reason === 'string', `${key}: 칸/설명 오류`);
  }
  for (const [key, mine] of [['my_strong_piece', true], ['opponent_strong_piece', false]] as const) {
    const item = a[key];
    if (item === null) continue;
    const fact = object(item) ? p.context.pieces.find(x => x.square === item.square) : undefined;
    const isWhite = fact ? fact.piece === fact.piece.toUpperCase() : null;
    check(!!fact && fact.piece === item.piece && (isWhite === (p.context.side_to_move === 'white')) === mine && typeof item.reason === 'string', `${key}: 기물·색·칸 불일치`);
  }
  check(Array.isArray(a.claims) && a.claims.length <= 8, '핵심 사실 목록 형식 오류');
  for (const c of Array.isArray(a.claims) ? a.claims : []) {
    const fact = object(c) ? p.context.pieces.find(x => x.square === (c.kind === 'attacks' ? c.from : c.square)) : undefined;
    const ok = !!fact && (c.kind === 'piece_at' ? fact.piece === c.piece : c.kind === 'attacks' ? fact.attacks.includes(c.to) : c.kind === 'pinned' ? fact.absolutely_pinned : false);
    check(ok, `핵심 사실 불일치: ${object(c) ? JSON.stringify(c) : '잘못된 형식'}`);
  }
  for (const key of ['plan', 'alternative']) check(object(a[key]) && p.context.legal_moves_uci.includes(a[key].move_uci) && typeof a[key].reason === 'string', `${key}: 불법 수 또는 설명 누락`);
  check(object(a.plan) && typeof a.plan.next_goal === 'string', '다음 목표 누락');
  check(a.plan?.move_uci !== a.alternative?.move_uci, '대안이 추천수와 같습니다.');
  check(Array.isArray(a.branches) && a.branches.length >= 1 && a.branches.length <= 2, '진행 예시 형식 오류');
  const replies: string[] = [];
  for (const [i, branch] of (Array.isArray(a.branches) ? a.branches : []).entries()) {
    if (!object(branch) || !Array.isArray(branch.moves_uci) || branch.moves_uci.length < 1 || branch.moves_uci.length > 6) { check(false, `진행 ${i + 1}: 수순 길이/형식 오류`); continue; }
    check(branch.moves_uci[0] === a.plan?.move_uci, `진행 ${i + 1}: 추천수와 다른 시작`);
    check(typeof branch.explanation === 'string', `진행 ${i + 1}: 설명 누락`);
    const board = new Chess(p.fen);
    for (const move of branch.moves_uci) {
      try { if (!uci(move)) throw Error(); board.move(moveObject(move)); check(true, ''); }
      catch { check(false, `진행 ${i + 1}: 불법 수 ${String(move).slice(0, 10)}`); break; }
    }
    if (branch.moves_uci[1]) replies.push(branch.moves_uci[1]);
  }
  if (replies.length === 2) check(replies[0] !== replies[1], '두 진행의 상대 첫 응수가 같습니다.');
  return { checks, errors, proseReview: 'pending' };
}

export function priceFor(m: Model, date = new Date()) {
  const factor = m.provider === 'google' && date >= new Date('2027-01-01T00:00:00Z') ? 2 : 1;
  return { input: m.input * factor, cached: m.cached * factor, output: m.output * factor };
}
export function reserveCost(p: ChessPosition, m: Model) {
  const rate = priceFor(m);
  return ((Buffer.byteLength(p.prompt) + 1024) * rate.input * (m.provider === 'openai' ? 1.25 : 1) + OUTPUT_LIMIT * rate.output) / 1e6;
}
export function parseGeneration(m: Model, data: any) {
  const openai = m.provider === 'openai';
  const usage = openai ? data.usage : data.usageMetadata;
  const text = openai
    ? (data.output ?? []).filter((x: any) => x.type === 'message').flatMap((x: any) => x.content ?? []).filter((x: any) => x.type === 'output_text').map((x: any) => x.text ?? '').join('')
    : (data.candidates?.[0]?.content?.parts ?? []).filter((x: any) => !x.thought).map((x: any) => x.text ?? '').join('');
  const completed = openai ? data.status === 'completed' : data.candidates?.[0]?.finishReason === 'STOP';
  const actualModel = (openai ? data.model : data.modelVersion) ?? null;
  const modelMismatch = typeof actualModel === 'string' && actualModel !== m.id && !actualModel.startsWith(m.id + '-');
  let answer: unknown = null;
  try { answer = JSON.parse(text); } catch { /* Preserve invalid text and any billed usage. */ }
  const input = openai ? usage?.input_tokens : usage?.promptTokenCount;
  const cached = (openai ? usage?.input_tokens_details?.cached_tokens : usage?.cachedContentTokenCount) ?? 0;
  const reasoning = (openai ? usage?.output_tokens_details?.reasoning_tokens : usage?.thoughtsTokenCount) ?? 0;
  const output = openai ? usage?.output_tokens : typeof usage?.candidatesTokenCount === 'number' ? usage.candidatesTokenCount + reasoning : undefined;
  const hasUsage = [input, cached, output, reasoning].every(n => Number.isFinite(n) && n >= 0) && cached <= input;
  const rate = priceFor(m);
  const cost = hasUsage ? ((input - cached) * rate.input + cached * rate.cached + output * rate.output) / 1e6 : null;
  const upper = cost === null ? null : cost + (openai ? (input - cached) * rate.input * .25 / 1e6 : 0);
  return { status: modelMismatch ? 'model_mismatch' : completed && object(answer) ? 'completed' : 'incomplete_or_invalid',
    actualModel, answer: object(answer) ? answer : null, answerText: text,
    tokens: hasUsage ? { input, cached, output, reasoning } : null, usage: usage ?? null,
    costUsd: cost, costUpperUsd: upper, rate,
    finishReason: openai ? (data.incomplete_details?.reason ?? data.status) : (data.candidates?.[0]?.finishReason ?? 'no_candidate') };
}

type Dependencies = { verify?: typeof verifyComparisonOwner; request?: typeof fetch;
  keys?: () => { openai?: string; google?: string }; timeoutMs?: number };
const keySource = () => ({ openai: process.env.OPENAI_API_KEY, google: process.env.GEMINI_API_KEY });
export function registerChessComparison(app: Express, deps: Dependencies = {}) {
  const verify = deps.verify ?? verifyComparisonOwner, request = deps.request ?? fetch, keys = deps.keys ?? keySource;
  const active = new Set<string>();
  const counts = new Map<string, { at: number; count: number }>();
  let verifying = 0;
  const auth: RequestHandler = async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (verifying >= 8) { res.status(429).json({ error: 'BUSY' }); return; }
    const token = req.headers.authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
    if (!token) { res.status(401).json({ error: 'AUTH_REQUIRED' }); return; }
    verifying++;
    try { res.locals.chessOwner = await verify(token); next(); }
    catch { res.status(403).json({ error: 'OWNER_ONLY' }); }
    finally { verifying--; }
  };
  const router = express.Router();
  router.use(auth, express.json({ limit: '4kb' }));
  router.get('/config', (_req, res) => res.json({ revision: CHESS_REVISION, createdAt: reference.created_at,
    outputLimit: OUTPUT_LIMIT, priceCheckedAt: '2026-09-23', models: MODELS.map(m => ({ ...m, configured: !!keys()[m.provider], rate: priceFor(m) })),
    positions: POSITIONS.map(p => ({ ...p, reservedUsd: Object.fromEntries(MODELS.map(m => [m.id, reserveCost(p, m)])) })) }));
  router.post('/check', async (req, res) => {
    const ids = req.body?.models;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > MODELS.length || new Set(ids).size !== ids.length || ids.some(id => !MODELS.some(m => m.id === id))) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }
    const checks = await Promise.all(ids.map(async id => {
      const m = MODELS.find(m => m.id === id)!; const key = keys()[m.provider];
      if (!key) return { model: id, status: 'missing_key' };
      try {
        const r = await request(m.provider === 'openai' ? `https://api.openai.com/v1/models/${m.id}` : `https://generativelanguage.googleapis.com/v1beta/models/${m.id}`, {
          headers: m.provider === 'openai' ? { Authorization: `Bearer ${key}` } : { 'x-goog-api-key': key },
          signal: AbortSignal.timeout(15000), redirect: 'error' });
        await r.body?.cancel();
        return { model: id, status: r.ok ? 'accessible' : `http_${r.status}` };
      } catch { return { model: id, status: 'connection_error' }; }
    }));
    res.json({ checks, generationCalls: 0, note: '모델 조회 성공은 생성·결제 성공을 보장하지 않습니다.' });
  });
  router.post('/run', async (req, res) => {
    const { model, positionId, reasoning = 'medium' } = req.body ?? {};
    const m = MODELS.find(m => m.id === model), p = POSITIONS.find(p => p.id === positionId);
    if (!m || !p || !['low', 'medium', 'high'].includes(reasoning) || Object.keys(req.body).some(k => !['model', 'positionId', 'reasoning'].includes(k))) { res.status(400).json({ error: 'INVALID_REQUEST' }); return; }
    const key = keys()[m.provider];
    if (!key) { res.status(503).json({ error: 'MISSING_KEY', model }); return; }
    const owner = res.locals.chessOwner as string, now = Date.now();
    const count = counts.get(owner);
    if (active.has(owner)) { res.status(409).json({ error: 'ALREADY_RUNNING' }); return; }
    // Per-instance protection. The browser also reserves the whole selected batch before starting.
    if (count && now - count.at < 30 * 60000 && count.count >= 120) { res.status(429).json({ error: 'RUN_LIMIT' }); return; }
    counts.set(owner, count && now - count.at < 30 * 60000 ? { ...count, count: count.count + 1 } : { at: now, count: 1 });
    active.add(owner);
    const controller = new AbortController();
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', onClose);
    const start = performance.now();
    const common = { model, positionId, revision: CHESS_REVISION, promptSha256: p.prompt_sha256,
      createdAt: new Date().toISOString(), settings: { outputLimit: OUTPUT_LIMIT, reasoning: m.provider === 'openai' ? reasoning : 'provider_default', serviceTier: 'standard' }, reservedUsd: reserveCost(p, m) };
    try {
      const openai = m.provider === 'openai';
      const response = await request(openai ? 'https://api.openai.com/v1/responses' : `https://generativelanguage.googleapis.com/v1beta/models/${m.id}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(openai ? { Authorization: `Bearer ${key}` } : { 'x-goog-api-key': key }) },
        body: JSON.stringify(openai ? { model: m.id, input: p.prompt, max_output_tokens: OUTPUT_LIMIT, store: false,
          reasoning: { effort: reasoning }, service_tier: 'default', text: { format: { type: 'json_object' } } }
          : { contents: [{ role: 'user', parts: [{ text: p.prompt }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: OUTPUT_LIMIT } }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(deps.timeoutMs ?? 120000)]), redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        res.json({ ...common, status: 'api_error', httpStatus: response.status, latencySeconds: (performance.now() - start) / 1000, costUsd: null, costUpperUsd: null }); return;
      }
      const raw = await response.json();
      const latencySeconds = (performance.now() - start) / 1000;
      const parsed = parseGeneration(m, raw);
      res.json({ ...common, ...parsed, latencySeconds, validation: validateAnswer(p, parsed.answer) });
    } catch {
      if (!res.destroyed) res.json({ ...common, status: 'connection_error', latencySeconds: (performance.now() - start) / 1000, costUsd: null, costUpperUsd: null });
    } finally { active.delete(owner); res.off('close', onClose); }
  });
  app.use('/api/chess-benchmark', router);
}
