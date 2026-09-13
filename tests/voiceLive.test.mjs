import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {collectLive, liveSession, speechPlayback, summarizeLive} from '../scripts/voice-benchmark/live.mjs';
import {toWav, BYTES_PER_SECOND} from '../scripts/voice-benchmark/core.mjs';

const samples = (ms, value = 1000) => {
  const pcm = Buffer.alloc(ms * BYTES_PER_SECOND / 1000);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(value, i);
  return pcm;
};
class Socket extends EventEmitter {
  constructor(handle) { super(); this.handle = handle; this.sent = []; queueMicrotask(() => this.emit('open')); }
  send(raw) { const event = JSON.parse(raw); this.sent.push(event); this.handle(this, event); }
  reply(event) { this.emit('message', Buffer.from(JSON.stringify(event))); }
  close() { this.closed = true; this.emit('close'); }
  terminate() { this.terminated = true; this.close(); }
}
const args = {wav: toWav(samples(20)), source: 'ko', target: 'ja', key: 'test-only-key', tailMs: 20, startupTimeoutMs: 500, finalizeTimeoutMs: 500};
const closed = {type: 'session.closed', reason: 'close_requested', usage: {seconds: 7}, session: liveSession('ko', 'ja')};

test('Live uses its own startup protocol, exact source PCM, silence after stop, and a fully drained close', async () => {
  const pcm = samples(210), output = samples(20, -1200);
  let socket, appends = 0;
  const run = await collectLive({...args, wav: toWav(pcm), tailMs: 210,
    socketFactory: (url, options) => {
      assert.equal(url, 'wss://api.openai.com/v1/live/sessions');
      assert.equal(options.headers.Authorization, 'Bearer test-only-key');
      return socket = new Socket((ws, event) => {
        if (event.type === 'session.start') {
          assert.equal(event.session.model, 'gpt-live-1');
          assert.equal(event.session.store, false);
          assert.deepEqual(event.session.delegation, {type: 'client'});
          assert.deepEqual(event.session.audio.format, {type: 'audio/pcm', rate: 24000});
          assert.match(event.session.instructions, /Korean into Japanese/);
          // Minimal documented ready event: omitted optional fields are not invented.
          setTimeout(() => { assert.equal(ws.sent.length, 1); ws.reply({type: 'session.started', session: {model: 'gpt-live-1'}}); }, 5);
        }
        if (event.type === 'session.input_audio.append') {
          appends++;
          ws.reply({type: 'session.usage.updated', usage: {seconds: appends}});
          if (appends === 1) {
            ws.reply({type: 'session.input_transcript.delta', delta: '안녕', start_ms: 0, end_ms: 100});
            ws.reply({type: 'session.output_transcript.delta', delta: 'こん', start_ms: 50, end_ms: 100});
            ws.reply({type: 'session.output_audio.delta', delta: output.toString('base64')});
          }
        }
        if (event.type === 'session.close') {
          setTimeout(() => {
            ws.reply({type: 'session.input_transcript.delta', delta: '하세요.', start_ms: 0, end_ms: 100});
            ws.reply({type: 'session.output_transcript.delta', delta: 'にちは。', start_ms: 50, end_ms: 100});
            ws.reply({type: 'session.output_audio.delta', delta: output.toString('base64')});
            ws.reply(closed);
          }, 5);
        }
      });
    }});
  const chunks = socket.sent.filter(e => e.type === 'session.input_audio.append').map(e => Buffer.from(e.audio, 'base64'));
  assert.deepEqual(chunks.map(p => p.length), [9600, 480, 9600, 480]);
  assert.deepEqual(Buffer.concat(chunks.slice(0, 2)), pcm);
  assert.deepEqual(Buffer.concat(chunks.slice(2)), Buffer.alloc(10080));
  assert.equal(run.transport.queuedPcmSha256, createHash('sha256').update(pcm).digest('hex'));
  assert.equal(run.transport.inputPcmSha256, run.transport.queuedPcmSha256);
  assert.equal(run.transport.queuedPcmBytes, pcm.length);
  assert.equal(run.transport.tailSilencePcmBytes, 10080);
  assert.ok(run.stopMs - run.setupMs >= 200);
  assert.ok(run.transport.closeRequestedAfterStopMs >= 200);
  assert.equal(run.transport.usageSeconds, 7, 'final cumulative usage replaces prior snapshots');
  assert.equal(run.transport.finalUsageConfirmed, true);
  assert.equal(run.transport.closeConfirmed, true);
  assert.equal(run.inputTranscript, '안녕하세요.');
  assert.equal(run.transcript, 'こんにちは。');
  assert.equal(run.transcriptEvents.length, 4, 'same timestamp ranges must not deduplicate text');
  assert.deepEqual(Buffer.concat(run.packets.map(p => p.pcm)), Buffer.concat([output, output]));
  assert.deepEqual([...new Set(socket.sent.map(e => e.type))], ['session.start', 'session.input_audio.append', 'session.close']);
  const report = summarizeLive(run);
  assert.equal(report.qualityStatus, 'not_assessed');
  assert.equal(report.turnCompletionConfirmed, false);
  assert.equal('stopToCompleteMs' in report, false, 'capture duration is not translation completion latency');
  assert.ok(report.stopToSessionClosedMs >= 200);
});

test('Live fails before sending source audio if model, audio, delegation, storage or voice is wrong', async () => {
  for (const session of [null, {model: 'gpt-realtime-2.1'}, {...liveSession('ko', 'ja'), audio: {format: {type: 'audio/pcm', rate: 16000}}},
    {...liveSession('ko', 'ja'), delegation: {type: 'responses'}}, {...liveSession('ko', 'ja'), store: true},
    {...liveSession('ko', 'ja'), audio: {output: {voice: 'other'}}}]) {
    let socket;
    await assert.rejects(collectLive({...args, socketFactory: () => socket = new Socket((ws, event) => {
      if (event.type === 'session.start') ws.reply({type: 'session.started', session});
    })}), error => { assert.equal(error.partialRun.transport.queuedPcmBytes, 0); return true; });
    assert.deepEqual(socket.sent.map(e => e.type), ['session.start']);
    assert.equal(socket.terminated, true);
  }
});

test('Live never retries or executes backend work and preserves source evidence on a later failure', async () => {
  let socket, connections = 0;
  await assert.rejects(collectLive({...args, socketFactory: () => {
    connections++;
    return socket = new Socket((ws, event) => {
      if (event.type === 'session.start') ws.reply({type: 'session.started', session: liveSession('ko', 'ja')});
      if (event.type === 'session.input_audio.append') {
        ws.reply({type: 'session.input_transcript.delta', delta: '감사합니다.'});
        ws.reply({type: 'session.usage.updated', usage: {seconds: 2}});
        ws.reply({type: 'session.delegation.created', delegation: {target: 'client'}});
      }
    });
  }}), error => {
    assert.match(error.message, /does not execute/);
    assert.equal(error.partialRun.inputTranscript, '감사합니다.');
    assert.equal(error.partialRun.transport.usageSeconds, 2);
    assert.equal(error.partialRun.transport.finalUsageConfirmed, false);
    return true;
  });
  assert.equal(connections, 1);
  assert.ok(socket.sent.every(e => e.type === 'session.start' || e.type === 'session.input_audio.append'));
});

test('socket close and terminal errors cannot masquerade as a successful full capture', async () => {
  for (const reason of ['socket', 'content', 'expired', 'connection_lost']) {
    await assert.rejects(collectLive({...args, socketFactory: () => new Socket((ws, event) => {
      if (event.type === 'session.start') ws.reply({type: 'session.started', session: liveSession('ko', 'ja')});
      if (event.type === 'session.close') {
        if (reason === 'socket') ws.close();
        else ws.reply({...closed, reason});
      }
    })}), error => {
      assert.equal(error.partialRun.transport.finalUsageConfirmed, reason !== 'socket');
      assert.equal(error.partialRun.transport.closeConfirmed, reason !== 'socket');
      return true;
    });
  }
});

test('missing startup and missing finalization have bounded timeouts', async () => {
  await assert.rejects(collectLive({...args, startupTimeoutMs: 15, socketFactory: () => new Socket(() => {})}), /startup timed out/);
  await assert.rejects(collectLive({...args, finalizeTimeoutMs: 15, socketFactory: () => new Socket((ws, event) => {
    if (event.type === 'session.start') ws.reply({type: 'session.started', session: liveSession('ko', 'ja')});
  })}), /did not confirm session.closed/);
});

test('Live error reporting retains safe codes and HTTP status, not raw credential-bearing messages', async () => {
  await assert.rejects(collectLive({...args, socketFactory: () => new Socket((ws) => {
    ws.reply({type: 'error', error: {code: 'unknown_parameter', message: 'sensitive-provider-message'}});
  })}), error => { assert.equal(error.message, 'GPT-Live: unknown_parameter'); return true; });
  await assert.rejects(collectLive({...args, socketFactory: () => new Socket((ws) => {
    ws.emit('unexpected-response', {}, {statusCode: 401, resume() {}});
  })}), /HTTP 401/);
});

test('leading signal gate retains pre-roll and every later pause without moving audio before its arrival', () => {
  const silence = samples(500, 0), voice = samples(20), pause = samples(400, 0), tail = samples(50);
  const raw = {packets: [{atMs: 0, pcm: silence}, {atMs: 900, pcm: voice}, {atMs: 1000, pcm: pause}, {atMs: 1800, pcm: tail}],
    stopMs: 800, doneMs: 2000, transcript: 'test', inputTranscript: 'test', transport: {}};
  const playback = speechPlayback(raw), joined = Buffer.concat(playback.packets.map(p => p.pcm));
  assert.equal(playback.playbackGate.skippedLeadingMs, 300);
  assert.deepEqual(joined, Buffer.concat([samples(200, 0), voice, pause, tail]));
  assert.deepEqual(playback.packets.map(p => p.atMs), [900, 900, 1000, 1800]);
  assert.deepEqual(raw.packets[0].pcm, silence);
  const summary = summarizeLive(raw);
  assert.equal(summary.playbackEstimate.stopToFirstSignalEstimateMs, 450);
  assert.equal(summary.stopToFirstSignalEstimateMs, 650);
  assert.ok(summary.playbackEstimate.simulatedQueueGapCount > 0, 'later gaps must not be edited away');
});

test('initial silence within a packet and silent-only output do not fabricate speech or a quality pass', () => {
  const run = {packets: [{atMs: 1000, pcm: Buffer.concat([samples(600, 0), samples(50)])}], stopMs: 900, doneMs: 2000,
    transcript: '', inputTranscript: '', transport: {}};
  assert.equal(speechPlayback(run).playbackGate.skippedLeadingMs, 400);
  const silent = {...run, packets: [{atMs: 1000, pcm: samples(100, 0)}]};
  const summary = summarizeLive(silent);
  assert.equal(summary.playbackEstimate.stopToFirstSignalEstimateMs, null);
  assert.equal(summary.playbackEstimate.skippedLeadingMs, 0);
  assert.equal(summary.qualityStatus, 'not_assessed');
  assert.ok(summary.reviewWarnings.includes('NO_SIGNAL_ABOVE_THRESHOLD'));
  assert.ok(summary.reviewWarnings.includes('NO_OUTPUT_TRANSCRIPT'));
  assert.ok(summary.reviewWarnings.includes('FIXED_CAPTURE_WINDOW_NO_TURN_DONE'));
});

test('Live CLI preflight and validation require no key or paid call and cannot select another provider', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'voice-live-test-'));
  const env = {...process.env}; delete env.OPENAI_API_KEY;
  const script = new URL('../scripts/voice-benchmark/live.mjs', import.meta.url).pathname;
  try {
    const audio = path.join(dir, 'input.wav'); writeFileSync(audio, args.wav);
    const cliArgs = [script, '--audio', audio, '--source', 'ko', '--target', 'ja'];
    const preflight = spawnSync(process.execPath, cliArgs, {env, encoding: 'utf8', timeout: 3000});
    assert.equal(preflight.status, 0, preflight.stderr);
    assert.deepEqual(JSON.parse(preflight.stdout), {status: 'preflight_only', model: 'gpt-live-1', sourceDurationMs: 20, tailWindowMs: 30000, willCallPaidApis: false});
    const missing = spawnSync(process.execPath, [...cliArgs, '--run'], {env, encoding: 'utf8', timeout: 3000});
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /No paid API calls/);
    for (const flag of ['--synthetic', '--provider']) {
      const invalid = spawnSync(process.execPath, [...cliArgs, flag], {env, encoding: 'utf8', timeout: 3000});
      assert.equal(invalid.status, 1);
      assert.match(invalid.stderr, /Unknown option/);
    }
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
