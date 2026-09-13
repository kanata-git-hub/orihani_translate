import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {readWav, toWav, summarize, outputFormat, BYTES_PER_SECOND} from '../scripts/voice-benchmark/core.mjs';
import {collect} from '../scripts/voice-benchmark/run.mjs';
import {generateSyntheticInput, SYNTHETIC_CASES} from '../scripts/voice-benchmark/synthetic.mjs';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

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

test('mostly silent output reports delayed signal separately from early packet arrival without assigning a quality pass', () => {
  const result = summarize({packets: [{atMs: 0, pcm: samples(2000, 0)}, {atMs: 500, pcm: samples(20)}], stopMs: 100, doneMs: 600, transcript: 'えっと、'});
  assert.equal(result.status, 'audio_received');
  assert.equal(result.qualityStatus, 'not_assessed');
  assert.equal(result.stopToFirstPacketMs, 0);
  assert.equal(result.stopToFirstSignalPacketMs, 400);
  assert.equal(result.stopToFirstSignalEstimateMs, 2150);
  assert.ok(result.zeroSampleFraction > 0.99);
  assert.deepEqual(result.reviewWarnings, ['MOSTLY_DIGITAL_SILENCE']);
});

test('output metadata controls WAV headers, duration and stereo signal offset while input remains fixed at 24 kHz mono', () => {
  const audioFormat = outputFormat({format: 'pcm16', sample_rate: 48000, channels: 2});
  const pcm = Buffer.alloc(48000 * 2 * 2 / 10);
  pcm.writeInt16LE(1000, 2400 * 4 + 2);
  const wav = toWav(pcm, audioFormat);
  assert.equal(wav.readUInt16LE(22), 2);
  assert.equal(wav.readUInt32LE(24), 48000);
  assert.equal(wav.readUInt32LE(28), 192000);
  assert.equal(wav.readUInt16LE(32), 4);
  assert.deepEqual(wav.subarray(44), pcm);
  const result = summarize({packets: [{atMs: 0, pcm, audioFormat}], outputFormat: audioFormat, stopMs: 0, doneMs: 100});
  assert.equal(result.audioDurationMs, 100);
  assert.equal(result.stopToFirstSignalEstimateMs, 200);
  assert.equal(result.outputFormat.sampleRateDeclared, true);
  assert.throws(() => readWav(wav), /mono PCM16/);
  assert.throws(() => toWav(Buffer.alloc(2), audioFormat), /sample frame/);
  for (const metadata of [{format: 'opus'}, {sample_rate: 0}, {channels: 1.5}]) assert.throws(() => outputFormat(metadata), /Unsupported/);
});

class Socket extends EventEmitter {
  constructor(handle) { super(); this.handle = handle; this.sent = []; queueMicrotask(() => this.emit('open')); }
  send(raw) { const value = JSON.parse(raw); this.sent.push(value); this.handle(this, value); }
  reply(event) { this.emit('message', Buffer.from(JSON.stringify(event))); }
  close() { this.closed = true; this.emit('close'); }
  terminate() { this.terminated = true; this.close(); }
}

test('OpenAI queues complete 200 ms input frames plus the remainder and preserves output metadata across deltas', async () => {
  const input = samples(500), output = samples(20);
  let socket;
  const session = {type: 'translation', model: 'gpt-realtime-translate', audio: {output: {language: 'ja'}}};
  const result = await collect({provider: 'openai', wav: toWav(input), source: 'ko', target: 'ja', key: 'test-only', timeoutMs: 2000,
    socketFactory: () => socket = new Socket((ws, event) => {
      if (event.type === 'session.update') ws.reply({type: 'session.updated', session});
      if (event.type === 'session.close') {
        ws.reply({type: 'session.output_audio.delta', delta: output.toString('base64'), format: 'pcm16', sample_rate: 48000, channels: 2});
        ws.reply({type: 'session.output_audio.delta', delta: output.toString('base64')});
        ws.reply({type: 'session.closed'});
      }
    })});
  const chunks = socket.sent.filter(e => e.type === 'session.input_audio_buffer.append').map(e => Buffer.from(e.audio, 'base64'));
  assert.deepEqual(chunks.map(c => c.length), [9600, 9600, 4800]);
  assert.deepEqual(Buffer.concat(chunks), input);
  assert.equal(result.transport.queuedPcmBytes, input.length);
  assert.equal(result.transport.queuedChunks, 3);
  assert.equal(result.transport.queuedPcmSha256, createHash('sha256').update(input).digest('hex'));
  assert.equal(result.transport.queuedPcmSha256, result.transport.inputPcmSha256);
  assert.equal(result.transport.closeRequested, true);
  assert.equal(result.transport.closeConfirmed, true);
  assert.equal(result.transport.serverSession.targetLanguage, 'ja');
  assert.ok(result.stopMs - result.setupMs >= 490, 'simulate capture time before sending the final frame');
  assert.deepEqual(result.packets[0].audioFormat, result.packets[1].audioFormat);
  assert.equal(result.outputFormat.sampleRate, 48000);
  assert.equal(result.outputFormat.channelsDeclared, true);
  assert.equal(summarize(result).audioDurationMs, 10);
});

test('mismatched server session and changing output format fail instead of producing a misleading recording', async () => {
  const args = {provider: 'openai', wav: toWav(samples(20)), source: 'ko', target: 'ja', key: 'test-only', timeoutMs: 1000};
  await assert.rejects(collect({...args, socketFactory: () => new Socket((ws, event) => {
    if (event.type === 'session.update') ws.reply({type: 'session.updated', session: {model: 'gpt-realtime-translate', type: 'translation', audio: {output: {language: 'ko'}}}});
  })}), /does not match/);
  await assert.rejects(collect({...args, socketFactory: () => new Socket((ws, event) => {
    if (event.type === 'session.update') ws.reply({type: 'session.updated'});
    if (event.type === 'session.close') {
      ws.reply({type: 'session.output_audio.delta', delta: samples(20).toString('base64'), sample_rate: 48000});
      ws.reply({type: 'session.output_audio.delta', delta: samples(20).toString('base64'), sample_rate: 24000});
    }
  })}), /format changed/);
});

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
          assert.equal(Object.hasOwn(event.session.audio.input, 'transcription'), false, 'ordinary comparison must not enable paid source transcription');
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

test('synthetic fixtures retain identical PCM, source text and AI provenance in both languages', async () => {
  for (const source of ['ko', 'ja']) {
    const pcm = samples(200);
    let calls = 0;
    const result = await generateSyntheticInput({source, key: 'test-only', fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.openai.com/v1/audio/speech');
      assert.equal(options.headers.Authorization, 'Bearer test-only');
      assert.equal(options.redirect, 'error');
      const body = JSON.parse(options.body);
      assert.equal(body.response_format, 'pcm');
      assert.equal(body.input, SYNTHETIC_CASES[source].text);
      return {ok: true, arrayBuffer: async () => pcm};
    }});
    assert.equal(calls, 1);
    assert.deepEqual(readWav(result.wav).pcm, pcm);
    assert.equal(result.provenance.kind, 'synthetic');
    assert.equal(result.provenance.text, SYNTHETIC_CASES[source].text);
    assert.match(result.provenance.limits, /may bias results/);
    assert.equal(JSON.stringify(result.provenance).includes('test-only'), false);
  }
});

test('synthetic generation blocks missing keys and unsupported language before a request', async () => {
  const fetchImpl = () => { throw new Error('unexpected request'); };
  await assert.rejects(generateSyntheticInput({source: 'ko', fetchImpl}), /OPENAI_API_KEY/);
  await assert.rejects(generateSyntheticInput({source: 'en', key: 'test-only', fetchImpl}), /ko or ja/);
});

test('synthetic request failures hide raw responses and never retry or silently truncate', async () => {
  let calls = 0;
  await assert.rejects(generateSyntheticInput({source: 'ko', key: 'test-only', fetchImpl: async () => {
    calls++; return {ok: false, status: 401, text: () => { throw new Error('do not read raw response'); }};
  }}), /^Error: Synthetic speech request failed \(HTTP 401\)\.$/);
  assert.equal(calls, 1);
  for (const pcm of [Buffer.alloc(0), Buffer.alloc(3), samples(30001)]) {
    await assert.rejects(generateSyntheticInput({source: 'ja', key: 'test-only', fetchImpl: async () => ({ok: true, arrayBuffer: async () => pcm})}));
  }
});

test('synthetic CLI preflight works without a recording or key and run requires a key', () => {
  const env = {...process.env}; delete env.OPENAI_API_KEY;
  const script = new URL('../scripts/voice-benchmark/run.mjs', import.meta.url);
  const args = [script.pathname, '--synthetic', '--source', 'ko', '--target', 'ja'];
  const preflight = spawnSync(process.execPath, args, {env, encoding: 'utf8', timeout: 3000});
  assert.equal(preflight.status, 0, preflight.stderr);
  const data = JSON.parse(preflight.stdout);
  assert.equal(data.willCallPaidApis, false);
  assert.equal(data.inputKind, 'synthetic');
  assert.equal(data.sampleText, SYNTHETIC_CASES.ko.text);
  const run = spawnSync(process.execPath, [...args, '--run'], {env, encoding: 'utf8', timeout: 3000});
  assert.equal(run.status, 1);
  assert.match(run.stderr, /No paid API calls were made/);
});

test('input diagnosis collects append-only source deltas through graceful close without feeding them into translation', async () => {
  const input = samples(40);
  let socket;
  const session = {type: 'translation', model: 'gpt-realtime-translate', audio: {input: {transcription: {model: 'gpt-realtime-whisper'}}, output: {language: 'ja'}}};
  const run = await collect({provider: 'openai', wav: toWav(input), source: 'ko', target: 'ja', key: 'test-only', diagnoseInput: true, timeoutMs: 1000,
    socketFactory: () => socket = new Socket((ws, event) => {
      if (event.type === 'session.update') {
        assert.equal(event.session.audio.input.transcription.model, 'gpt-realtime-whisper');
        ws.reply({type: 'session.updated', session});
      }
      if (event.type === 'session.input_audio_buffer.append') {
        ws.reply({type: 'session.input_transcript.delta', delta: '예약을 ', elapsed_ms: 200});
        ws.reply({type: 'session.input_transcript.delta', delta: '바꿔', elapsed_ms: 200});
      }
      if (event.type === 'session.close') setTimeout(() => {
        ws.reply({type: 'session.input_transcript.delta', delta: ' 주세요.', elapsed_ms: 400});
        ws.reply({type: 'session.output_transcript.delta', delta: '変更してください。'});
        ws.reply({type: 'session.closed'});
      }, 5);
    })});
  assert.equal(run.inputTranscript, '예약을 바꿔 주세요.');
  assert.equal(run.transcript, '変更してください。');
  assert.equal(run.transport.serverEventCounts['session.input_transcript.delta'], 3);
  assert.equal(run.transport.serverSession.inputTranscriptionModel, 'gpt-realtime-whisper');
  assert.deepEqual(Buffer.concat(socket.sent.filter(e => e.type === 'session.input_audio_buffer.append').map(e => Buffer.from(e.audio, 'base64'))), input);
  assert.deepEqual([...new Set(socket.sent.map(e => e.type))], ['session.update', 'session.input_audio_buffer.append', 'session.close']);
  assert.equal(summarize(run).reviewWarnings.includes('NO_INPUT_TRANSCRIPT_RECEIVED'), false);
});

test('input diagnosis stops before audio if the server does not confirm transcription and preserves that evidence', async () => {
  let socket;
  const session = {type: 'translation', model: 'gpt-realtime-translate', audio: {output: {language: 'ja'}}};
  await assert.rejects(collect({provider: 'openai', wav: toWav(samples(20)), source: 'ko', target: 'ja', key: 'test-only', diagnoseInput: true,
    socketFactory: () => socket = new Socket((ws, event) => {
      if (event.type === 'session.update') ws.reply({type: 'session.updated', session});
    })}), error => {
    assert.match(error.message, /did not confirm/);
    assert.equal(error.partialRun.transport.queuedPcmBytes, 0);
    assert.equal(error.partialRun.transport.serverSession.inputTranscriptionModel, null);
    return true;
  });
  assert.equal(socket.sent.some(e => e.type === 'session.input_audio_buffer.append'), false);
});

test('source evidence survives a later provider error and empty source transcript gets a diagnostic-only warning', async () => {
  const session = {type: 'translation', model: 'gpt-realtime-translate', audio: {input: {transcription: {model: 'gpt-realtime-whisper'}}, output: {language: 'ja'}}};
  await assert.rejects(collect({provider: 'openai', wav: toWav(samples(20)), source: 'ko', target: 'ja', key: 'test-only', diagnoseInput: true,
    socketFactory: () => new Socket((ws, event) => {
      if (event.type === 'session.update') ws.reply({type: 'session.updated', session});
      if (event.type === 'session.close') {
        ws.reply({type: 'session.input_transcript.delta', delta: '안녕하세요.'});
        ws.reply({type: 'error', error: {code: 'server_error', message: 'do not expose raw provider message'}});
      }
    })}), error => {
    assert.equal(error.message, 'openai: server_error');
    assert.equal(error.partialRun.inputTranscript, '안녕하세요.');
    assert.equal(error.partialRun.transport.serverEventCounts.error, 1);
    return true;
  });
  const empty = {packets: [], stopMs: 0, doneMs: 10, transcript: '', inputTranscript: ''};
  assert.equal(summarize(empty).reviewWarnings.includes('NO_INPUT_TRANSCRIPT_RECEIVED'), false);
  assert.equal(summarize({...empty, transport: {inputTranscriptionModelRequested: 'gpt-realtime-whisper'}}).reviewWarnings.includes('NO_INPUT_TRANSCRIPT_RECEIVED'), true);
});

test('diagnostic CLI requires existing audio and OpenAI-only selection, preflights without a key and never generates speech', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'voice-diagnostic-test-'));
  const env = {...process.env}; delete env.OPENAI_API_KEY;
  const script = new URL('../scripts/voice-benchmark/run.mjs', import.meta.url).pathname;
  try {
    const audio = path.join(dir, 'input.wav'); writeFileSync(audio, toWav(samples(20)));
    const args = [script, '--audio', audio, '--source', 'ko', '--target', 'ja', '--provider', 'openai', '--diagnose-input'];
    const preflight = spawnSync(process.execPath, args, {env, encoding: 'utf8', timeout: 3000});
    assert.equal(preflight.status, 0, preflight.stderr);
    const data = JSON.parse(preflight.stdout);
    assert.equal(data.willCallPaidApis, false);
    assert.equal(data.inputKind, 'provided_audio');
    assert.equal(data.inputTranscriptionModel, 'gpt-realtime-whisper');
    const missingKey = spawnSync(process.execPath, [...args, '--run'], {env, encoding: 'utf8', timeout: 3000});
    assert.match(missingKey.stderr, /No paid API calls were made/);
    for (const inputArgs of [['--synthetic', '--provider', 'openai'], ['--audio', audio]]) {
      const invalid = spawnSync(process.execPath, [script, ...inputArgs, '--source', 'ko', '--target', 'ja', '--diagnose-input', '--run'], {env, encoding: 'utf8', timeout: 3000});
      assert.equal(invalid.status, 1);
      assert.match(invalid.stderr, /requires --provider openai and an existing --audio file/);
    }
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
