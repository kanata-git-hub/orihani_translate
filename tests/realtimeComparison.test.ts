import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { createRealtimeComparison, realtimeComparisonSession, REALTIME_MODEL } from '../realtimeComparison.ts';

function fixture(source = 'ko', graceMs = 10) {
  class Socket extends EventEmitter {
    readyState = WebSocket.CONNECTING as number;
    bufferedAmount = 0;
    sent: any[] = [];
    send(raw: string) { this.sent.push(JSON.parse(raw)); }
    close() { this.readyState = WebSocket.CLOSED; this.emit('close'); }
    terminate() { this.close(); }
    receive(event: object) { this.emit('message', Buffer.from(JSON.stringify(event))); }
  }
  const socket = new Socket(), ready: any[] = [], audio: string[] = [], texts: any[] = [], done: any[] = [];
  let clock = 1000, connection: any;
  const adapter = createRealtimeComparison({ source, key: 'private-test-key', transcriptionGraceMs: graceMs, now: () => ++clock,
    connect: (url, options) => { connection = { url, options }; return socket as unknown as WebSocket; },
    ready: value => ready.push(value), audio: value => audio.push(value), text: (input, output) => texts.push({ input, output }),
    done: (error, evidence) => done.push({ error, evidence }),
  });
  socket.readyState = WebSocket.OPEN; socket.emit('open');
  const session = socket.sent[0].session;
  const accept = () => socket.receive({ type: 'session.updated', session });
  const stop = () => { adapter.append(Buffer.alloc(9600, 1)); return adapter.stop(clock); };
  const commit = () => socket.receive({ type: 'input_audio_buffer.committed', item_id: 'input-1' });
  const response = () => socket.receive({ type: 'response.created', response: { id: 'reply-1' } });
  const emit = (type: string, fields = {}) => socket.receive({ type, response_id: 'reply-1', ...fields });
  const transcript = () => socket.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'input-1', transcript: '가상의 시험 원문' });
  const complete = (fields = {}) => socket.receive({ type: 'response.done', response: { id: 'reply-1', status: 'completed', ...fields } });
  return { socket, adapter, connection, session, ready, audio, texts, done, accept, stop, commit, response, emit, transcript, complete };
}

test('Realtime uses both language directions, no VAD, and a generic whole-utterance instruction', () => {
  assert.throws(() => realtimeComparisonSession('en'), /INVALID_LANGUAGE/);
  for (const source of ['ko', 'ja']) {
    const f = fixture(source);
    try {
      assert.equal(f.connection.url, `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`);
      assert.equal(f.session.model, REALTIME_MODEL);
      assert.equal(f.session.audio.input.turn_detection, null);
      assert.equal(f.session.audio.input.noise_reduction, null);
      assert.deepEqual(f.session.audio.input.transcription, { model: 'gpt-4o-transcribe', language: source });
      assert.deepEqual(f.session.output_modalities, ['audio']);
      assert.equal(f.session.reasoning.effort, 'low');
      assert.match(f.session.instructions, source === 'ko' ? /Korean into Japanese/ : /Japanese into Korean/);
      assert.match(f.session.instructions, /entire recorded utterance/);
      assert.doesNotMatch(f.session.instructions, /会計|計算|いなり|2泊|3泊/);
      f.accept(); assert.equal(f.ready.length, 1);
    } finally { f.adapter.cancel(); }
  }
});

test('audio streams before stop, but exactly one response is requested only after the complete input is committed', () => {
  const f = fixture();
  try {
    f.accept(); const evidence = f.stop();
    assert.equal(evidence.bytes, 9600);
    assert.equal(evidence.pcmSha256, createHash('sha256').update(Buffer.alloc(9600, 1)).digest('hex'));
    assert.deepEqual(f.socket.sent.map(e => e.type), ['session.update', 'input_audio_buffer.append', 'input_audio_buffer.commit']);
    f.commit(); assert.equal(f.socket.sent.filter(e => e.type === 'response.create').length, 1);
    assert.throws(() => f.adapter.append(Buffer.alloc(4800)), /REALTIME_INVALID_INPUT/);
    assert.throws(() => f.adapter.stop(1000));
    f.commit(); // Invalid duplicate cannot trigger a second paid response.
    assert.equal(f.socket.sent.filter(e => e.type === 'response.create').length, 1);
    assert.equal(f.done[0].error, 'REALTIME_INVALID_RESPONSE');
  } finally { f.adapter.cancel(); }
});

test('a changed session or an early response fails closed before any translated audio is relayed', () => {
  for (const change of ['vad', 'model', 'prompt', 'reasoning', 'early-created', 'early-audio']) {
    const f = fixture();
    try {
      if (change === 'vad') f.session.audio.input.turn_detection = { type: 'server_vad' };
      if (change === 'model') f.session.model = 'another-model';
      if (change === 'prompt') f.session.instructions = 'different';
      if (change === 'reasoning') f.session.reasoning.effort = 'high';
      if (change.startsWith('early')) {
        f.accept(); f.adapter.append(Buffer.alloc(4800));
        if (change === 'early-created') f.response();
        else f.emit('response.output_audio.delta', { delta: '6APoAw==' });
      } else f.accept();
      assert.equal(f.audio.length, 0); assert.equal(f.done.length, 1);
      assert.equal(f.socket.sent.filter(e => e.type === 'response.create').length, 0);
      assert.match(f.done[0].error, /^REALTIME_(SESSION_MISMATCH|EARLY_RESPONSE)$/);
    } finally { f.adapter.cancel(); }
  }
});

test('audio plays before diagnostic transcription; final transcript and numeric usage are recorded once', () => {
  const f = fixture();
  try {
    f.accept(); f.stop(); f.commit(); f.response();
    f.emit('response.output_audio.delta', { delta: '6APoAw==' });
    f.emit('response.output_audio_transcript.delta', { delta: 'こんにちは' });
    f.emit('response.output_audio_transcript.done', { transcript: 'こんにちは。' });
    assert.equal(f.audio.length, 1); assert.equal(f.done.length, 0);
    f.complete({ output: [{ content: [{ type: 'audio', transcript: 'こんにちは。' }] }],
      usage: { total_tokens: 100, input_tokens: 70, output_tokens: 30, private: 'secret', input_token_details: { audio_tokens: 65, headers: 'secret' } } });
    assert.equal(f.done.length, 0); // Only final report waits briefly, not audio playback.
    f.transcript();
    assert.equal(f.done.length, 1); assert.equal(f.done[0].error, undefined);
    assert.equal(f.done[0].evidence.responseCompleted, true);
    assert.deepEqual(f.texts.at(-1), { input: '가상의 시험 원문', output: 'こんにちは。' });
    assert.deepEqual(f.done[0].evidence.usage, { total_tokens: 100, input_tokens: 70, output_tokens: 30, input_token_details: { audio_tokens: 65 } });
    assert.ok(f.done[0].evidence.marks.firstAudio < f.done[0].evidence.marks.inputTranscriptionComplete);
    assert.ok(!JSON.stringify(f.done).includes('secret'));
    f.complete(); assert.equal(f.done.length, 1);
  } finally { f.adapter.cancel(); }
});

test('transcription failure or timeout does not erase a completed translation', async () => {
  for (const failure of ['failed', 'timeout']) {
    const f = fixture();
    try {
      f.accept(); f.stop(); f.commit(); f.response();
      f.emit('response.output_audio.delta', { delta: '6APoAw==' });
      if (failure === 'failed') f.socket.receive({ type: 'conversation.item.input_audio_transcription.failed', item_id: 'input-1' });
      f.complete(); await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(f.done.length, 1); assert.equal(f.done[0].error, undefined);
      assert.equal(f.done[0].evidence.transcriptionStatus, failure);
      assert.deepEqual(f.done[0].evidence.reviewWarnings, ['NO_OUTPUT_TRANSCRIPT']);
    } finally { f.adapter.cancel(); }
  }
});

test('incomplete, empty and disconnected responses are not successful translations', () => {
  for (const kind of ['incomplete', 'failed', 'cancelled', 'empty', 'close']) {
    const f = fixture();
    try {
      f.accept(); f.stop(); f.commit(); f.response(); f.transcript();
      if (kind !== 'empty') f.emit('response.output_audio.delta', { delta: '6APoAw==' });
      if (kind === 'close') f.socket.close();
      else f.complete({ status: kind === 'empty' ? 'completed' : kind });
      assert.equal(f.done.length, 1); assert.match(f.done[0].error, /^REALTIME_/);
    } finally { f.adapter.cancel(); }
  }
});

test('cancellation cancels an active response and closes the paid connection without late callbacks', () => {
  const f = fixture();
  f.accept(); f.stop(); f.commit(); f.response(); f.adapter.cancel(); f.adapter.cancel();
  assert.equal(f.socket.sent.filter(e => e.type === 'response.cancel').length, 1);
  assert.equal(f.socket.readyState, WebSocket.CLOSED); assert.equal(f.done.length, 0);
});

test('tiny or malformed input and backpressure cannot start an unbounded request', () => {
  const f = fixture();
  try {
    f.accept(); assert.throws(() => f.adapter.stop(1000), /TOO_SHORT/);
    assert.throws(() => f.adapter.append(Buffer.alloc(1)), /INVALID_INPUT/);
    assert.throws(() => f.adapter.append(Buffer.alloc(9602)), /INVALID_INPUT/);
    f.socket.bufferedAmount = 500001;
    assert.throws(() => f.adapter.append(Buffer.alloc(4800)), /CONNECTION_FAILED/);
    assert.equal(f.socket.sent.length, 1);
  } finally { f.adapter.cancel(); }
});
