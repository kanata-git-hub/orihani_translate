import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter, once } from 'node:events';
import { createHash } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { registerVoiceComparison, verifyComparisonOwner, liveComparisonSession, LIVE_PROMPT_REVISION, MAX_INPUT_BYTES } from '../voiceComparison.ts';
import { ComparisonPlayer, concatPcm, leadingSkip, wavBytes, signalRange } from '../src/utils/voiceComparison.ts';
import { PcmRecorder } from '../public/voice-compare-recorder.mjs';
import { buildGeminiVoicePrompt, GEMINI_VOICE_REVISION, GEMINI_THINKING_REVISION, processGeminiAudio } from '../geminiVoice.ts';

class ProviderSocket extends EventEmitter {
  readyState = WebSocket.CONNECTING as number;
  sent: any[] = [];
  kind: string;
  constructor(kind: string) {
    super(); this.kind = kind;
    queueMicrotask(() => { if (this.readyState !== WebSocket.CONNECTING) return; this.readyState = WebSocket.OPEN; this.emit('open'); });
  }
  send(text: string) {
    const m = JSON.parse(text); this.sent.push(m);
    if (m.type === 'session.start') queueMicrotask(() => this.receive({ type: 'session.started', session: m.session }));
    if (m.type === 'session.close') queueMicrotask(() => this.receive({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 1 } }));
  }
  receive(event: object) { this.emit('message', Buffer.from(JSON.stringify(event))); }
  close() { if (this.readyState === WebSocket.CLOSED) return; this.readyState = WebSocket.CLOSED; queueMicrotask(() => this.emit('close')); }
  terminate() { this.close(); }
}
async function fixture(options: { verify?: () => Promise<string>; key?: () => string | undefined; runGemini?: Parameters<typeof registerVoiceComparison>[2]['runGemini'] } = {}) {
  const server = createServer(), legacy = new WebSocketServer({ noServer: true }), upstream: ProviderSocket[] = [];
  legacy.on('connection', ws => ws.on('message', data => ws.send(data)));
  const comparison = registerVoiceComparison(server, legacy, {
    verify: options.verify ?? (async () => 'owner'), key: options.key ?? (() => 'fake-key'), tailMs: 250,
    runGemini: options.runGemini,
    connect: url => { const ws = new ProviderSocket(url.includes('openai') ? 'live' : 'gemini'); upstream.push(ws); return ws as unknown as WebSocket; },
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as any).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/voice-compare`, { origin: `http://127.0.0.1:${port}` });
  const events: any[] = []; ws.on('message', raw => events.push(JSON.parse(raw.toString())));
  await once(ws, 'open');
  async function waitFor(predicate: (e: any) => boolean) {
    for (let i = 0; i < 200; i++) {
      const found = events.find(predicate); if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail(`Missing event; received ${JSON.stringify(events)}`);
  }
  const close = async () => {
    ws.terminate(); for (const client of comparison.clients) client.terminate();
    for (const client of legacy.clients) client.terminate();
    comparison.close(); legacy.close(); await new Promise<void>(resolve => server.close(() => resolve()));
  };
  return { port, ws, events, upstream, waitFor, close };
}

test('owner authorization fails closed and does not call models without an authenticated owner and server key', async () => {
  for (const options of [{ verify: async () => { throw new Error('private error'); } }, { key: () => undefined }]) {
    const f = await fixture(options);
    try {
      f.ws.send(JSON.stringify({ type: 'auth', source: 'ko', token: 'not-a-real-token' }));
      const failure = await f.waitFor(e => e.type === 'error');
      assert.ok(['AUTH_REQUIRED', 'OPENAI_NOT_CONFIGURED'].includes(failure.code));
      assert.equal(f.upstream.length, 0);
      assert.ok(!JSON.stringify(f.events).includes('private error'));
    } finally { await f.close(); }
  }
});

test('Firebase validates the token server-side; verified owner only, no account details in errors', async () => {
  const token = 'x'.repeat(30);
  let body = '';
  const request = (user: object, ok = true) => (async (_url: string, init: RequestInit) => {
    body = init.body as string; return new Response(JSON.stringify({ users: [user] }), { status: ok ? 200 : 400 });
  }) as typeof fetch;
  const owner = { localId: 'owner', email: 'kanata840@gmail.com', emailVerified: true };
  assert.equal(await verifyComparisonOwner(token, request(owner)), 'owner');
  assert.deepEqual(JSON.parse(body), { idToken: token });
  for (const user of [{ ...owner, emailVerified: false }, { ...owner, disabled: true }, { ...owner, email: 'someone@example.com' }]) {
    await assert.rejects(verifyComparisonOwner(token, request(user)), /OWNER_ONLY/);
  }
  await assert.rejects(verifyComparisonOwner(token, request(owner, false)), /AUTH_REQUIRED/);
});

test('comparison evidence identifies the exact prompt sent upstream in each direction', async () => {
  const hashes: string[] = [];
  for (const source of ['ko', 'ja']) {
    const f = await fixture();
    try {
      f.ws.send(JSON.stringify({ type: 'auth', source, token: 'fake' }));
      const ready = await f.waitFor(e => e.type === 'ready');
      const request = f.upstream.find(s => s.kind === 'live')!.sent[0];
      const digest = createHash('sha256').update(request.session.instructions).digest('hex');
      assert.deepEqual(ready.promptEvidence, { live: { revision: LIVE_PROMPT_REVISION, sha256: digest } });
      hashes.push(digest);
    } finally { await f.close(); }
  }
  assert.notEqual(hashes[0], hashes[1]);
});

test('same PCM streams to Live before stop and goes to the unchanged Gemini route as one WAV after stop', async () => {
  const f = await fixture();
  try {
    f.ws.send(JSON.stringify({ type: 'auth', source: 'ja', token: 'fake' })); await f.waitFor(e => e.type === 'ready');
    const live = f.upstream.find(s => s.kind === 'live')!, gemini = f.upstream.find(s => s.kind === 'gemini')!;
    const pcm = Buffer.from([0, 0, 255, 127, 0, 128, 1, 0]);
    f.ws.send(JSON.stringify({ type: 'audio', audio: pcm.toString('base64') }));
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(gemini.sent.length, 0);
    assert.deepEqual(Buffer.from(live.sent[1].audio, 'base64'), pcm);
    f.ws.send(JSON.stringify({ type: 'stop', source: 'ko' })); // Cannot change the authenticated direction at stop.
    const input = await f.waitFor(e => e.type === 'input');
    assert.equal(input.pcmSha256, createHash('sha256').update(pcm).digest('hex'));
    assert.equal(input.liveQueuedPcmSha256, input.pcmSha256); assert.equal(input.liveQueuedBytes, pcm.length);
    assert.equal(gemini.sent.length, 1);
    assert.deepEqual(Buffer.from(gemini.sent[0].audio, 'base64').subarray(44), pcm);
    assert.equal(gemini.sent[0].role, 'foreigner'); assert.equal(gemini.sent[0].targetLanguageCode, 'ko');
    assert.equal(gemini.sent[0].type, 'process_audio'); assert.equal(gemini.sent[0].ttsEnabled, true);
    gemini.receive({ audio: pcm.toString('base64') });
    gemini.receive({ inputTranscription: 'こんにちは', outputTranscription: '안녕하세요', turnComplete: true });
    await f.waitFor(e => e.type === 'finished');
    assert.ok(live.sent.some(e => e.type === 'session.input_audio.append' && Buffer.from(e.audio, 'base64').every(v => v === 0)));
    assert.equal(f.events.find(e => e.type === 'done' && e.provider === 'live').turnCompletionConfirmed, false);
    assert.equal(f.events.find(e => e.type === 'done' && e.provider === 'live').usageSeconds, 1);
    assert.deepEqual(live.sent[0].session, liveComparisonSession('ja'));
    assert.ok(!JSON.stringify(live.sent).includes('input_audio_buffer.commit'));
  } finally { await f.close(); }
});

test('Gemini order comparison sends identical full audio only after stop, without any OpenAI key or connection', async () => {
  const calls: any[] = [];
  const f = await fixture({ key: () => { throw Error('OpenAI must not be used'); }, runGemini: async (msg, send, options) => {
    calls.push({ msg, options });
    send({ inputTranscription: '予約は維持します', outputTranscription: '예약을 유지할게요', partial: true });
    send({ audio: '6APoAw==' });
    send({ turnComplete: true });
    return { revision: GEMINI_VOICE_REVISION, outputOrder: options.outputOrder,
      promptSha256: createHash('sha256').update(buildGeminiVoicePrompt(msg, options.outputOrder)).digest('hex'),
      clock: 'test', marks: { firstTranslation: 12, firstAudio: 25 }, observedFieldOrder: [], tts: [] };
  } });
  try {
    f.ws.send(JSON.stringify({ type: 'auth', source: 'ja', mode: 'gemini_order', token: 'fake' }));
    const ready = await f.waitFor(e => e.type === 'ready');
    assert.equal(ready.mode, 'gemini_order'); assert.equal(ready.tailSeconds, 0);
    const pcm = Buffer.from([0, 0, 255, 127, 0, 128, 1, 0]);
    f.ws.send(JSON.stringify({ type: 'audio', audio: pcm.toString('base64') }));
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(calls.length, 0); assert.equal(f.upstream.length, 0);
    f.ws.send(JSON.stringify({ type: 'stop', source: 'ko', mode: 'live' }));
    const input = await f.waitFor(e => e.type === 'input');
    await f.waitFor(e => e.type === 'finished');
    assert.equal(calls.length, 2); assert.equal(f.upstream.length, 0);
    assert.equal(calls[0].msg.audio, calls[1].msg.audio);
    for (const call of calls) {
      assert.deepEqual(Buffer.from(call.msg.audio, 'base64').subarray(44), pcm);
      assert.equal(call.msg.targetLanguageCode, 'ko'); assert.equal(call.msg.role, 'foreigner');
      assert.equal(call.options.measure, true);
      const provider = call.options.outputOrder === 'translation_first' ? 'optimized' : 'gemini';
      const done = f.events.find(e => e.type === 'done' && e.provider === provider);
      assert.equal(done.timing.promptSha256, ready.promptEvidence[provider].sha256);
      assert.equal(done.turnCompletionConfirmed, true);
      assert.equal(input.variants[provider].pcmSha256, input.pcmSha256);
    }
    assert.deepEqual(calls.map(c => c.options.outputOrder).sort(), ['transcription_first', 'translation_first']);
    assert.equal(calls[0].options.originMs, calls[1].options.originMs);
  } finally { await f.close(); }
});

test('thinking trial changes only LOW, holds complete identical input until stop, and exports matching request evidence', async () => {
  const calls: any[] = [], requests: any[] = [];
  const f = await fixture({ key: () => { throw Error('OpenAI must not be used'); }, runGemini: async (msg, send, options) => {
    calls.push({ msg, options });
    return processGeminiAudio(msg, { send, generate: async request => {
      requests.push(request);
      return (async function* () {
        if (request.model.includes('tts')) yield { candidates: [{ content: { parts: [{ inlineData: { data: '6APoAw==' } }] } }] };
        else yield { text: '{"status":"SUCCESS","transcription":"계산해 주세요","translation":"お会計をお願いします。","pronunciation":""}', usageMetadata: { thoughtsTokenCount: 10 } };
      })();
    } }, options);
  } });
  try {
    f.ws.send(JSON.stringify({ type: 'auth', source: 'ko', mode: 'gemini_thinking', thinkingLevel: 'HIGH', token: 'fake' }));
    const ready = await f.waitFor(e => e.type === 'ready');
    assert.equal(ready.mode, 'gemini_thinking'); assert.equal(ready.tailSeconds, 0);
    assert.deepEqual(ready.promptEvidence.gemini, ready.promptEvidence.optimized);
    assert.equal(ready.requestEvidence.optimized.revision, GEMINI_THINKING_REVISION);
    assert.equal(ready.requestEvidence.optimized.thinkingLevel, 'LOW');
    assert.equal(ready.requestEvidence.gemini.thinkingLevel, 'DEFAULT');
    const pcm = Buffer.from([0, 0, 255, 127, 0, 128, 1, 0]);
    f.ws.send(JSON.stringify({ type: 'audio', audio: pcm.toString('base64') }));
    await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(calls.length, 0);
    f.ws.send(JSON.stringify({ type: 'stop', mode: 'live', source: 'ja', thinkingLevel: 'HIGH' }));
    const evidence = await f.waitFor(e => e.type === 'input');
    await f.waitFor(e => e.type === 'finished');
    assert.equal(calls.length, 2); assert.equal(f.upstream.length, 0);
    assert.equal(calls[0].msg.audio, calls[1].msg.audio);
    assert.equal(calls[0].options.originMs, calls[1].options.originMs);
    for (const call of calls) {
      assert.equal(call.options.outputOrder, 'transcription_first'); assert.equal(call.msg.targetLanguageCode, 'ja');
      assert.deepEqual(Buffer.from(call.msg.audio, 'base64').subarray(44), pcm);
      const provider = call.options.thinkingLevel === 'LOW' ? 'optimized' : 'gemini';
      assert.equal(evidence.variants[provider].pcmSha256, createHash('sha256').update(pcm).digest('hex'));
      const done = f.events.find(e => e.type === 'done' && e.provider === provider);
      assert.equal(done.timing.requestedThinkingLevel, ready.requestEvidence[provider].thinkingLevel);
      assert.equal(done.timing.promptSha256, ready.promptEvidence[provider].sha256);
      assert.equal(done.timing.usage.thoughtsTokenCount, 10); assert.equal(done.turnCompletionConfirmed, true);
    }
    const translation = requests.filter(r => !r.model.includes('tts'));
    const baseline = translation.find(r => !r.config.thinkingConfig), candidate = translation.find(r => r.config.thinkingConfig);
    assert.deepEqual(candidate.config.thinkingConfig, { thinkingLevel: 'LOW' });
    assert.equal(candidate.config.systemInstruction, baseline.config.systemInstruction);
    assert.equal(requests.length, 4);
  } finally { await f.close(); }
});

test('Gemini-only trials require owner authentication and reject unsupported modes before model calls', async () => {
  for (const mode of ['gemini_order', 'gemini_thinking', 'arbitrary-model']) {
    let calls = 0;
    const f = await fixture({ verify: mode !== 'arbitrary-model' ? async () => { throw Error('private'); } : undefined,
      runGemini: async () => { calls++; throw Error('must not run'); } });
    try {
      f.ws.send(JSON.stringify({ type: 'auth', source: 'ko', mode, token: 'fake' }));
      await f.waitFor(e => e.type === 'error');
      assert.equal(calls, 0); assert.equal(f.upstream.length, 0);
    } finally { await f.close(); }
  }
});

test('cancel aborts both Gemini variants; an individual model failure is reported without fallback calls', async () => {
  for (const mode of ['gemini_order', 'gemini_thinking']) {
  for (const cancel of [true, false]) {
    const signals: AbortSignal[] = [];
    const f = await fixture({ runGemini: async (_msg, _send, options) => {
      signals.push(options.signal);
      if (!cancel) throw Error('private provider error');
      await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
      throw Error('aborted');
    } });
    try {
      f.ws.send(JSON.stringify({ type: 'auth', source: 'ko', mode, token: 'fake' }));
      await f.waitFor(e => e.type === 'ready');
      f.ws.send(JSON.stringify({ type: 'audio', audio: '6APoAw==' })); f.ws.send(JSON.stringify({ type: 'stop' }));
      await f.waitFor(e => e.type === 'input');
      if (cancel) { f.ws.close(); await new Promise(resolve => setTimeout(resolve, 20)); }
      else {
        await f.waitFor(e => e.type === 'finished');
        assert.equal(f.events.filter(e => e.type === 'done' && e.error === 'GEMINI_FAILED').length, 2);
        assert.ok(!JSON.stringify(f.events).includes('private provider error'));
      }
      assert.equal(signals.length, 2); assert.ok(signals.every(s => s.aborted));
    } finally { await f.close(); }
  }
  }
});

test('legacy /live websocket still works; cross-origin comparison handshakes are rejected', async () => {
  const f = await fixture();
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${f.port}/live`); await once(ws, 'open');
    const reply = once(ws, 'message'); ws.send('original-protocol'); assert.equal((await reply)[0].toString(), 'original-protocol'); ws.close();
    const foreign = new WebSocket(`ws://127.0.0.1:${f.port}/voice-compare`, { origin: 'https://elsewhere.example' });
    await once(foreign, 'error'); assert.equal(f.upstream.length, 0);
  } finally { await f.close(); }
});

test('oversized input aborts both providers and closes the paid connection', async () => {
  const f = await fixture();
  try {
    f.ws.send(JSON.stringify({ type: 'auth', source: 'ko', token: 'fake' })); await f.waitFor(e => e.type === 'ready');
    const audio = Buffer.alloc(9600).toString('base64');
    for (let i = 0; i <= MAX_INPUT_BYTES / 9600; i++) f.ws.send(JSON.stringify({ type: 'audio', audio }));
    await f.waitFor(e => e.type === 'error');
    assert.ok(f.upstream.every(s => s.readyState === WebSocket.CLOSED));
  } finally { await f.close(); }
});

test('cancelling a trial closes both providers, with no second trial or fallback', async () => {
  const f = await fixture();
  try {
    f.ws.send(JSON.stringify({ type: 'auth', source: 'ko', token: 'fake' })); await f.waitFor(e => e.type === 'ready');
    f.ws.close(); await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(f.upstream.length, 2); assert.ok(f.upstream.every(s => s.readyState === WebSocket.CLOSED));
  } finally { await f.close(); }
});

test('provider failure during recording aborts the trial without sending a Gemini request', async () => {
  const f = await fixture();
  try {
    f.ws.send(JSON.stringify({ type: 'auth', source: 'ko', token: 'fake' })); await f.waitFor(e => e.type === 'ready');
    f.upstream.find(s => s.kind === 'live')!.receive({ type: 'error', error: { message: 'private-provider-details' } });
    await f.waitFor(e => e.type === 'error');
    assert.ok(f.upstream.every(s => s.readyState === WebSocket.CLOSED));
    assert.equal(f.upstream.find(s => s.kind === 'gemini')!.sent.length, 0);
    assert.ok(!JSON.stringify(f.events).includes('private-provider-details'));
    assert.ok(!f.events.some(e => e.type === 'finished'));
  } finally { await f.close(); }
});

function fakeAudio() {
  const nodes: any[] = [], gains: any[] = [];
  const context: any = { state: 'running', currentTime: 0, destination: {},
    createGain() { const gain = { gain: { value: 1 }, connect() {}, disconnect() {} }; gains.push(gain); return gain; },
    createBuffer(_n: number, samples: number, rate: number) { return { duration: samples / rate, getChannelData: () => new Float32Array(samples) }; },
    createBufferSource() { const node = { buffer: null, stopped: false, at: null, connect() {}, disconnect() {}, start(at: number) { this.at = at; }, stop() { this.stopped = true; } }; nodes.push(node); return node; },
  };
  return { context, nodes, gains };
}
const tone = (samples: number, value = 1000) => {
  const bytes = new Uint8Array(samples * 2), v = new DataView(bytes.buffer);
  for (let i = 0; i < samples; i++) v.setInt16(i * 2, value, true);
  return bytes;
};

test('walkie-talkie holds both outputs until stop and unmutes only the selected model', () => {
  const { context, nodes, gains } = fakeAudio();
  const live = new ComparisonPlayer(context, true), gemini = new ComparisonPlayer(context, false);
  live.receive(tone(4800)); gemini.receive(tone(4800)); assert.equal(nodes.length, 0);
  live.release(performance.now()); gemini.release(performance.now()); assert.equal(nodes.length, 2);
  assert.deepEqual(gains.map(g => g.gain.value), [1, 0]);
  live.cancel(); gemini.cancel(); assert.ok(nodes.every(n => n.stopped));
});

test('leading gate preserves pre-roll and internal pauses; tail gaps are not speech gaps', () => {
  const { context } = fakeAudio(); const player = new ComparisonPlayer(context, true);
  player.receive(tone(24000, 0)); assert.equal(player.playable.length, 0);
  player.receive(tone(2400)); assert.equal(player.skipBytes, (24000 - 4800) * 2);
  player.release(performance.now());
  context.currentTime = 1; player.receive(tone(2400)); // Actual gap before more speech.
  context.currentTime = 3; player.receive(tone(2400, 0)); // Tail gap after all speech.
  assert.equal(player.metrics().allQueueGaps.length, 2);
  assert.equal(player.metrics().signalSpanQueueGapsMs.length, 1);
  assert.equal(concatPcm(player.raw).length, 62400);
  assert.equal(leadingSkip(tone(4800, 0)), null);
  assert.equal(signalRange(concatPcm(player.playable)).last, 9599);
});

test('resampling 44.1/48 kHz across callback boundaries preserves duration and PCM sample values', () => {
  for (const rate of [24000, 44100, 48000]) {
    const parts: Uint8Array[] = [], recorder = new PcmRecorder(rate, (bytes: Uint8Array) => parts.push(bytes));
    const input = new Float32Array(rate).fill(-0.5);
    for (let i = 0; i < input.length; i += 128) recorder.push(input.subarray(i, i + 128));
    recorder.flush(); const bytes = concatPcm(parts);
    assert.equal(bytes.length, 48000); assert.equal(parts.length, 5);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < bytes.length; i += 2) assert.equal(view.getInt16(i, true), -16384);
    assert.deepEqual(wavBytes(bytes).slice(44), bytes);
  }
});
