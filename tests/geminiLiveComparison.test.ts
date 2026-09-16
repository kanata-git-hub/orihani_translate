import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { createGeminiLiveComparison, geminiLiveSetup } from '../geminiLiveComparison.ts';
import { realtimeComparisonSession } from '../realtimeComparison.ts';
import { productionVoiceSession } from '../voiceEngine.ts';

function fixture(source = 'ko') {
  class Socket extends EventEmitter {
    readyState = WebSocket.OPEN as number; bufferedAmount = 0; sent: any[] = [];
    send(raw: string) { this.sent.push(JSON.parse(raw)); }
    close() { this.readyState = WebSocket.CLOSED; this.emit('close'); }
    terminate() { this.close(); }
    receive(event: object) { this.emit('message', Buffer.from(JSON.stringify(event))); }
  }
  const socket = new Socket(), audio: string[] = [], texts: any[] = [], done: any[] = [], ready: any[] = [];
  const adapter = createGeminiLiveComparison({ source, key: 'private-test-key', connect: () => socket as unknown as WebSocket,
    now: () => 1100, ready: e => ready.push(e), audio: a => audio.push(a), text: (input, output) => texts.push({ input, output }),
    done: (error, evidence) => done.push({ error, evidence }),
  });
  socket.emit('open');
  const accept = () => socket.receive({ setupComplete: {} });
  const stop = () => { adapter.append(Buffer.alloc(9600, 1)); return adapter.stop(1000); };
  return { socket, adapter, audio, texts, done, ready, accept, stop };
}
const part = { inlineData: { mimeType: 'audio/pcm;rate=24000', data: '6APoAw==' } };

test('Gemini uses the same generic instructions in both directions, manual turns, and the exact normal Live model', () => {
  for (const source of ['ko', 'ja']) {
    const setup = geminiLiveSetup(source);
    assert.equal(setup.model, 'models/gemini-3.8-live');
    assert.equal(setup.systemInstruction.parts[0].text, productionVoiceSession({ role: source === 'ko' ? 'user' : 'foreigner', foreignerLang: 'ja', ttsEnabled: true, opponentText: '' }).instructions);
    assert.ok(setup.systemInstruction.parts[0].text.startsWith(realtimeComparisonSession(source).instructions));
    assert.doesNotMatch(JSON.stringify(setup), /会計|計算|いなり|油揚げ|thinkingConfig|translationConfig/);
    assert.equal(setup.realtimeInputConfig.automaticActivityDetection.disabled, true);
  }
  assert.throws(() => geminiLiveSetup('en'), /INVALID_LANGUAGE/);
});

test('same PCM24k is streamed within one manual activity; only stop ends the activity, once', () => {
  const f = fixture();
  try {
    assert.throws(() => f.adapter.append(Buffer.alloc(4800)));
    f.accept(); f.adapter.append(Buffer.alloc(4800, 2));
    assert.equal(f.socket.sent.filter(m => m.realtimeInput?.activityEnd).length, 0);
    const result = f.stop();
    assert.equal(f.socket.sent.filter(m => m.realtimeInput?.activityStart).length, 1);
    assert.equal(f.socket.sent.filter(m => m.realtimeInput?.activityEnd).length, 1);
    const sent = f.socket.sent.filter(m => m.realtimeInput?.audio).map(m => Buffer.from(m.realtimeInput.audio.data, 'base64'));
    assert.equal(result.pcmSha256, createHash('sha256').update(Buffer.concat(sent)).digest('hex'));
    assert.equal(result.bytes, 14400);
    assert.throws(() => f.adapter.stop(1000)); assert.throws(() => f.adapter.append(Buffer.alloc(4800)));
  } finally { f.adapter.cancel(); }
});

test('relays all audio parts and transcripts before confirming turn completion; generationComplete alone is insufficient', () => {
  const f = fixture();
  try {
    f.accept(); f.socket.receive({ serverContent: { inputTranscription: { text: '원문' } } });
    f.stop();
    f.socket.receive({ serverContent: { modelTurn: { parts: [part, part] }, outputTranscription: { text: '번역' }, generationComplete: true },
      usageMetadata: { totalTokenCount: 12, private: 'secret', promptTokensDetails: [{ modality: 'AUDIO', tokenCount: 8, private: 'secret' }] } });
    assert.equal(f.audio.length, 2); assert.equal(f.done.length, 0);
    f.socket.receive({ serverContent: { modelTurn: { parts: [part] }, inputTranscription: { text: ' 끝' }, outputTranscription: { text: ' 끝' }, turnComplete: true } });
    assert.equal(f.audio.length, 3); assert.equal(f.done.length, 1);
    assert.deepEqual(f.texts.at(-1), { input: '원문 끝', output: '번역 끝' });
    assert.equal(f.done[0].error, undefined); assert.equal(f.done[0].evidence.responseCompleted, true);
    assert.equal(f.done[0].evidence.outputPcmBytes, 12);
    assert.equal(f.done[0].evidence.marks.firstAudio, 100);
    assert.doesNotMatch(JSON.stringify(f.done), /secret|private-test-key/);
  } finally { f.adapter.cancel(); }
});

test('early output, interruption, empty audio and invalid audio rate fail without false completion', () => {
  for (const kind of ['early', 'interrupted', 'empty', 'rate']) {
    const f = fixture();
    try {
      f.accept(); if (kind !== 'early') f.stop();
      const content = kind === 'early' ? { modelTurn: { parts: [part] } }
        : kind === 'interrupted' ? { interrupted: true, turnComplete: true }
        : kind === 'empty' ? { turnComplete: true }
        : { modelTurn: { parts: [{ inlineData: { ...part.inlineData, mimeType: 'audio/pcm;rate=16000' } }] } };
      f.socket.receive({ serverContent: content });
      assert.equal(f.audio.length, 0); assert.equal(f.done.length, 1); assert.ok(f.done[0].error);
      if (kind !== 'empty') assert.equal(f.done[0].evidence.responseCompleted, false);
    } finally { f.adapter.cancel(); }
  }
});

test('provider errors are sanitized, cancellation closes once, and input/output are bounded', () => {
  const f = fixture();
  f.accept(); f.socket.receive({ error: { message: 'private-test-key secret-url' } });
  assert.equal(f.done[0].error, 'GEMINI_LIVE_FAILED'); assert.doesNotMatch(JSON.stringify(f.done), /private-test-key|secret-url/);
  f.adapter.cancel(); f.adapter.cancel(); assert.equal(f.done.length, 1); assert.equal(f.socket.readyState, WebSocket.CLOSED);
  const large = fixture();
  try {
    large.accept(); for (let i = 0; i < 150; i++) large.adapter.append(Buffer.alloc(9600));
    assert.throws(() => large.adapter.append(Buffer.alloc(2)));
    large.adapter.stop(1000);
    const data = Buffer.alloc(6_000_002).toString('base64');
    large.socket.receive({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: part.inlineData.mimeType, data } }] } } });
    assert.equal(large.audio.length, 0); assert.equal(large.done[0].error, 'GEMINI_LIVE_INVALID_RESPONSE');
  } finally { large.adapter.cancel(); }
  const slow = fixture();
  try { slow.accept(); slow.socket.bufferedAmount = 500001; assert.throws(() => slow.adapter.append(Buffer.alloc(4800))); }
  finally { slow.adapter.cancel(); }
});
