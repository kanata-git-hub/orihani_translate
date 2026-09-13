import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readWav, toWav, summarize, BYTES_PER_SECOND} from '../scripts/voice-benchmark/core.mjs';
import {collect} from '../scripts/voice-benchmark/run.mjs';

const samples = (durationMs, value = 1000) => {
  const result = Buffer.alloc(BYTES_PER_SECOND * durationMs / 1000);
  for (let i = 0; i < result.length; i += 2) result.writeInt16LE(value, i);
  return result;
};

test('benchmark preserves PCM exactly and rejects wrong format, excessive duration and truncated input', () => {
  const pcm = samples(100);
  assert.deepEqual(readWav(toWav(pcm)).pcm, pcm);
  const stereo = toWav(pcm); stereo.writeUInt16LE(2, 22);
  const wrongRate = toWav(pcm); wrongRate.writeUInt32LE(16000, 24);
  for (const wav of [stereo, wrongRate, toWav(pcm).subarray(0, 44), toWav(Buffer.alloc(0)), toWav(samples(30001))]) {
    assert.throws(() => readWav(wav));
  }
});

test('packets received while speaking are held until stop without losing their beginning', () => {
  const result = summarize({packets: [{atMs: 50, pcm: samples(300)}, {atMs: 500, pcm: samples(200)}], stopMs: 1000, doneMs: 1050});
  assert.equal(result.stopToFirstPacketMs, 0);
  assert.equal(result.stopToFirstScheduledAudioMs, 150);
  assert.equal(result.stopToFirstSignalEstimateMs, 150);
  assert.equal(result.audioDurationMs, 500);
  assert.equal(result.simulatedQueueGapCount, 0);
});

test('late packets expose queue gaps and an offline buffering lower bound', () => {
  const result = summarize({packets: [{atMs: 1200, pcm: samples(100)}, {atMs: 1700, pcm: samples(100)}], stopMs: 1000, doneMs: 1750});
  assert.equal(result.stopToFirstScheduledAudioMs, 350);
  assert.deepEqual(result.simulatedQueueGapMs, [400]);
  assert.equal(result.hindsightMinimumStartDelayMs, 600);
});

test('silent output is not mistaken for audible speech', () => {
  const result = summarize({packets: [{atMs: 100, pcm: samples(100, 0)}], stopMs: 0, doneMs: 200});
  assert.equal(result.stopToFirstSignalEstimateMs, null);
});

class Socket extends EventEmitter {
  constructor(handle) { super(); this.handle = handle; this.sent = []; queueMicrotask(() => this.emit('open')); }
  send(raw) { const value = JSON.parse(raw); this.sent.push(value); this.handle(this, value); }
  reply(event) { this.emit('message', Buffer.from(JSON.stringify(event))); }
  close() { this.closed = true; this.emit('close'); }
  terminate() { this.terminated = true; this.close(); }
}

test('OpenAI collection waits for drained output after session.close and retains every sample and transcript delta', async () => {
  const input = samples(40), first = samples(20), last = samples(30, 2000);
  let socket;
  const result = await collect({provider: 'openai', wav: toWav(input), source: 'ja', target: 'ko', key: 'test-only', timeoutMs: 1000,
    socketFactory: (url, options) => {
      assert.match(url, /\/realtime\/translations\?model=gpt-realtime-translate$/);
      assert.equal(options.headers.Authorization, 'Bearer test-only');
      socket = new Socket((ws, event) => {
        if (event.type === 'session.update') {
          assert.equal(event.session.audio.output.language, 'ko');
          queueMicrotask(() => ws.reply({type: 'session.updated'}));
        }
        if (event.type === 'session.input_audio_buffer.append' && ws.sent.filter(e => e.type === event.type).length === 1) {
          ws.reply({type: 'session.output_audio.delta', delta: first.toString('base64')});
          ws.reply({type: 'session.output_transcript.delta', delta: '안녕'});
        }
        if (event.type === 'session.close') {
          assert.equal(ws.closed, undefined, 'must not close the socket before output drains');
          setTimeout(() => {
            ws.reply({type: 'session.output_audio.delta', delta: last.toString('base64')});
            ws.reply({type: 'session.output_transcript.delta', delta: '하세요'});
            ws.reply({type: 'session.closed'});
          }, 5);
        }
      });
      return socket;
    }});
  assert.deepEqual(Buffer.concat(socket.sent.filter(e => e.type === 'session.input_audio_buffer.append').map(e => Buffer.from(e.audio, 'base64'))), input);
  assert.deepEqual(Buffer.concat(result.packets.map(p => p.pcm)), Buffer.concat([first, last]));
  assert.equal(result.transcript, '안녕하세요');
  assert.ok(result.packets[0].atMs < result.stopMs);
  assert.ok(result.packets[1].atMs >= result.stopMs);
  assert.equal(socket.closed, true);
});

test('baseline uses the existing audio protocol and sends exactly the same recording', async () => {
  const wav = toWav(samples(40));
  const result = await collect({provider: 'baseline', wav, source: 'ko', target: 'ja', timeoutMs: 1000,
    socketFactory: (url, options) => {
      assert.deepEqual(options, {}, 'never send an OpenAI credential to the baseline server');
      return new Socket((ws, event) => {
        assert.equal(event.type, 'process_audio');
        assert.equal(event.role, 'user');
        assert.equal(event.targetLanguageCode, 'ja');
        assert.equal(event.mimeType, 'audio/wav');
        assert.deepEqual(Buffer.from(event.audio, 'base64'), wav);
        ws.reply({role: 'user', outputTranscription: 'はい', audio: samples(20).toString('base64')});
        ws.reply({role: 'user', outputTranscription: 'はい。', turnComplete: true});
      });
    }});
  assert.equal(result.transcript, 'はい。');
  assert.equal(result.packets.length, 1);
});

test('missing credentials and unsupported directions fail before any connection', () => {
  const socketFactory = () => { throw new Error('unexpected connection'); };
  const args = {provider: 'openai', wav: toWav(samples(20)), source: 'ko', target: 'ja', socketFactory};
  assert.throws(() => collect(args), /OPENAI_API_KEY/);
  assert.throws(() => collect({...args, key: 'test-only', target: 'nl'}), /supported/);
});

test('premature connection close and timeout cannot count as completed translations', async () => {
  const args = {provider: 'openai', wav: toWav(samples(20)), source: 'ko', target: 'ja', key: 'test-only', timeoutMs: 20};
  await assert.rejects(collect({...args, socketFactory: () => new Socket(ws => ws.close())}), /before output completed/);
  await assert.rejects(collect({...args, socketFactory: () => new Socket(() => {})}), /Timed out/);
});
