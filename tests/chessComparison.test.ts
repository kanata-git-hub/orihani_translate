import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Chess } from 'chess.js';
import { readFileSync } from 'node:fs';
import { MODELS, POSITIONS, OUTPUT_LIMIT, parseGeneration, reserveCost, validateAnswer, registerChessComparison } from '../chessComparison.ts';
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });
const fixture = (answer: unknown = {}) => ({ status: 'completed', model: 'gpt-5.6-terra', usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 100 }, output_tokens: 300, output_tokens_details: { reasoning_tokens: 100 } }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] });
const emptyAnswer = { summary: '시험용', caveat: '시험용', my_weaknesses: [], opponent_weaknesses: [], my_strong_piece: null, opponent_strong_piece: null, claims: [] };
async function serve(deps: Parameters<typeof registerChessComparison>[1], fn: (base: string) => Promise<void>) {
  const app = express(); registerChessComparison(app, deps); app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  try { await fn(`http://127.0.0.1:${(server.address() as any).port}`); }
  finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
}
const auth = { Authorization: 'Bearer synthetic-owner-id-token', 'Content-Type': 'application/json' };

test('reference contains twelve valid positions and 277 legal half moves', () => {
  assert.equal(POSITIONS.length, 12); let count = 0;
  for (const p of POSITIONS) for (const line of p.context.engine_lines) {
    const b = new Chess(p.fen);
    for (const [i, m] of line.moves_uci.entries()) {
      assert.equal(b.move({ from: m.slice(0, 2), to: m.slice(2, 4), ...(m[4] ? { promotion: m[4] } : {}) }).san, line.moves_san[i]); count++;
    }
  }
  assert.equal(count, 277);
});

test('pin geometry and illegal recapture are distinguished; malformed prose cannot crash validation', () => {
  const p = POSITIONS.find(p => p.id === 'T3')!;
  const a = { ...emptyAnswer, plan: { move_uci: 'd1d4', reason: '시험용', next_goal: '시험용' }, alternative: { move_uci: 'b5c6', reason: '시험용' }, claims: [{ kind: 'attacks', from: 'c6', to: 'd4' }, { kind: 'pinned', square: 'c6' }], branches: [{ moves_uci: ['d1d4', 'c6d4'], explanation: '시험용' }] };
  const v = validateAnswer(p, a);
  assert.equal(v.errors.length, 1); assert.match(v.errors[0], /불법 수 c6d4/);
  for (const bad of [null, [], 'invalid', { claims: null, branches: [null] }, { my_strong_piece: {}, claims: [42], branches: [12] }]) assert.ok(validateAnswer(p, bad).errors.length);
});

test('counts reasoning once and preserves incomplete outputs and unknown cost', () => {
  const r = parseGeneration(MODELS[0], fixture());
  assert.equal(r.tokens?.output, 300); assert.equal(r.tokens?.reasoning, 100);
  assert.equal(r.costUsd, (900 * 2 + 100 * .2 + 300 * 12) / 1e6);
  assert.ok(r.costUpperUsd! >= r.costUsd!);
  const g = parseGeneration(MODELS[2], { modelVersion: 'gemini-3.8-flash', usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 200 }, candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }] });
  assert.equal(g.tokens?.output, 300);
  assert.equal(parseGeneration(MODELS[0], { ...fixture(), status: 'incomplete' }).status, 'incomplete_or_invalid');
  assert.equal(parseGeneration(MODELS[0], { ...fixture(), usage: undefined }).costUsd, null);
  assert.equal(parseGeneration(MODELS[0], { ...fixture(), model: 'different-model' }).status, 'model_mismatch');
  assert.equal(parseGeneration(MODELS[0], fixture([])).status, 'incomplete_or_invalid');
});

test('auth gates config, checks and paid calls; new routes do not intercept health', async () => {
  let calls = 0;
  await serve({ verify: async () => { throw Error('OWNER_ONLY'); }, request: async () => { calls++; return json({}); } }, async base => {
    assert.equal((await fetch(base + '/api/health')).status, 200);
    for (const route of ['config', 'check', 'run']) {
      const opt = route === 'config' ? {} : { method: 'POST', body: '{invalid-json' };
      assert.equal((await fetch(base + '/api/chess-benchmark/' + route, { ...opt, headers: { 'Content-Type': 'application/json' } })).status, 401);
      assert.equal((await fetch(base + '/api/chess-benchmark/' + route, { ...opt, headers: auth })).status, 403);
    }
    assert.equal(calls, 0);
  });
});

test('selected OpenAI uses identical fixed prompts without needing Gemini; no secret escapes', async () => {
  const bodies: any[] = [];
  const key = 'SERVER_KEY_SENTINEL_DO_NOT_EXPOSE';
  await serve({ verify: async () => 'owner', keys: () => ({ openai: key }), request: async (url, options) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    const payload = JSON.parse(options?.body as string); bodies.push(payload);
    return json({ ...fixture(emptyAnswer), model: payload.model });
  } }, async base => {
    const config = await (await fetch(base + '/api/chess-benchmark/config', { headers: auth })).text(); assert.ok(!config.includes(key));
    for (const model of ['gpt-5.6-terra', 'gpt-6-astra']) {
      const r = await fetch(base + '/api/chess-benchmark/run', { method: 'POST', headers: auth, body: JSON.stringify({ model, positionId: 'T1', reasoning: 'medium' }) });
      const result = await r.json(); assert.equal(r.status, 200); assert.equal(result.status, 'completed'); assert.ok(!JSON.stringify(result).includes(key));
      assert.equal(result.promptSha256, POSITIONS[0].prompt_sha256);
    }
    assert.equal(bodies.length, 2); assert.equal(bodies[0].input, bodies[1].input); assert.equal(bodies[0].max_output_tokens, OUTPUT_LIMIT);
    assert.deepEqual(bodies[0].reasoning, { effort: 'medium' });
    for (const bad of [{ model: 'other', positionId: 'T1' }, { model: 'gpt-5.6-terra', positionId: 'not-found' }, { model: 'gpt-5.6-terra', positionId: 'T1', prompt: 'client override' }]) {
      assert.equal((await fetch(base + '/api/chess-benchmark/run', { method: 'POST', headers: auth, body: JSON.stringify(bad) })).status, 400);
    }
    assert.equal(bodies.length, 2);
  });
});

test('availability check is generation-free; provider failures do not expose error bodies or retry', async () => {
  let calls = 0;
  await serve({ verify: async () => 'owner', keys: () => ({ openai: 'synthetic' }), request: async (_url, options) => {
    calls++; if (options?.method === 'POST') return json({ secret: 'PROVIDER_SECRET_SENTINEL' }, 403); return json({ id: 'model' });
  } }, async base => {
    const check = await (await fetch(base + '/api/chess-benchmark/check', { method: 'POST', headers: auth, body: JSON.stringify({ models: MODELS.map(m => m.id) }) })).json();
    assert.equal(check.generationCalls, 0); assert.equal(calls, 2); assert.equal(check.checks[2].status, 'missing_key');
    const result = await (await fetch(base + '/api/chess-benchmark/run', { method: 'POST', headers: auth, body: JSON.stringify({ model: 'gpt-5.6-terra', positionId: 'T1' }) })).json();
    assert.equal(calls, 3); assert.equal(result.status, 'api_error'); assert.equal(result.httpStatus, 403); assert.equal(result.costUsd, null);
    assert.ok(!JSON.stringify(result).includes('PROVIDER_SECRET_SENTINEL'));
  });
});

test('only new routes are wired; owner auth and legacy voice modules remain independent', () => {
  const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  assert.ok(server.indexOf('registerChessComparison(app)') < server.indexOf('app.use(express.json'));
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.ok(app.includes('lazy(() => import(\'./pages/ChessComparison\'))'));
  assert.ok(app.includes('/app/voice-compare')); assert.ok(app.includes('/app/chess-compare'));
  for (const p of POSITIONS) for (const model of MODELS) assert.ok(reserveCost(p, model) > 0);
});
