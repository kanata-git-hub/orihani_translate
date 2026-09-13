import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarize, toWav, outputFormat, BYTES_PER_SECOND} from '../scripts/voice-benchmark/core.mjs';
import {speechPlayback, summarizeLive} from '../scripts/voice-benchmark/live.mjs';
import {replayLiveReport, analyzeLivePlayback} from '../scripts/voice-benchmark/analyze-playback.mjs';

const samples = (ms, value = 1000) => {
  const pcm = Buffer.alloc(ms * BYTES_PER_SECOND / 1000);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(value, i);
  return pcm;
};
const runWith = packets => ({packets, stopMs: 0, doneMs: 3000, transcript: 'test', inputTranscript: 'test', outputFormat: outputFormat({sample_rate: 24000, channels: 1})});

test('queue gaps within the signal span and after trailing silence remain separate without discarding either', () => {
  const run = runWith([{atMs: 0, pcm: samples(200)}, {atMs: 800, pcm: samples(200)}, {atMs: 2000, pcm: samples(200, 0)}]);
  const result = summarize(run);
  assert.equal(result.stopToFirstSignalEstimateMs, 150);
  assert.deepEqual(result.simulatedQueueGapMs, [600, 1000]);
  assert.equal(result.signalSpanQueueGapCount, 1);
  assert.equal(result.afterSignalQueueGapCount, 1);
  assert.deepEqual(result.simulatedQueueGapDetails.map(g => g.relationToSignalSpan), ['within_signal_span', 'after_last_signal']);
  assert.deepEqual(result.simulatedQueueGapDetails.map(g => g.audioOffsetMs), [200, 400]);
  assert.deepEqual(result.simulatedQueueGapDetails.map(g => g.afterLastNonzero), [false, true]);
  const larger = summarize(run, {initialBufferMs: 1000});
  assert.equal(larger.stopToFirstSignalEstimateMs, 1000);
  assert.equal(larger.signalSpanQueueGapCount, 0);
  assert.throws(() => summarize(run, {initialBufferMs: 20}), /Invalid playback buffer/);
});

test('low-level sound after the last threshold crossing is not labeled digital silence', () => {
  const result = summarize(runWith([{atMs: 0, pcm: samples(100)}, {atMs: 1000, pcm: samples(100, 20)}]));
  assert.equal(result.afterSignalQueueGapCount, 1);
  assert.equal(result.simulatedQueueGapDetails[0].afterLastNonzero, false);
  assert.ok(result.signalRangeMs.lastNonzero > result.signalRangeMs.last);
});

test('silent-only output keeps its warning and receives no speech quality verdict', () => {
  const result = summarize(runWith([{atMs: 0, pcm: samples(100, 0)}, {atMs: 1000, pcm: samples(100, 0)}]));
  assert.equal(result.simulatedQueueGapCount, 1);
  assert.equal(result.signalSpanQueueGapCount, 0);
  assert.equal(result.afterSignalQueueGapCount, 0);
  assert.equal(result.simulatedQueueGapDetails[0].relationToSignalSpan, 'no_detected_signal');
  assert.equal(result.simulatedQueueGapDetails[0].afterLastNonzero, null);
  assert.equal(result.qualityStatus, 'not_assessed');
  assert.ok(result.reviewWarnings.includes('NO_SIGNAL_ABOVE_THRESHOLD'));
});

const fixture = () => {
  const run = runWith([{atMs: 50, pcm: samples(500, 0)}, {atMs: 600, pcm: samples(100)},
    {atMs: 710, pcm: samples(100)}, {atMs: 2000, pcm: samples(200, 0)}]);
  const report = {candidateModel: 'gpt-live-1', sourceSha256: 'fixture', runs: {live: summarizeLive(run)}};
  const wav = toWav(Buffer.concat(speechPlayback(run).packets.map(p => p.pcm)));
  return {run, report, wav};
};

test('offline replay reconstructs gated packet boundaries and reproduces original timing without editing the WAV', () => {
  const {report, wav} = fixture(), original = Buffer.from(wav);
  const replay = replayLiveReport(report, wav), result = analyzeLivePlayback(report, wav);
  const before = report.runs.live.playbackEstimate, after = result.profiles[0];
  assert.deepEqual(Buffer.concat(replay.packets.map(p => p.pcm)), wav.subarray(44));
  assert.equal(result.paidApiCalls, 0);
  assert.equal(after.stopToFirstSignalEstimateMs, before.stopToFirstSignalEstimateMs);
  assert.equal(after.totalQueueGapCount, before.simulatedQueueGapCount);
  assert.deepEqual(after.gapDetails, before.simulatedQueueGapDetails);
  assert.equal(after.signalSpanQueueGapCount, 0);
  assert.equal(after.afterSignalQueueGapCount, 1);
  assert.deepEqual(wav, original);
  assert.deepEqual(result.profiles.map(p => p.initialBufferMs), [150, 300, 500]);
});

test('offline replay rejects changed duration, format, timing and model instead of presenting misleading metrics', () => {
  const {report, wav} = fixture();
  assert.throws(() => replayLiveReport(report, toWav(wav.subarray(44, wav.length - 2))), /lengths do not match/);
  assert.throws(() => replayLiveReport(report, toWav(wav.subarray(44), {sampleRate: 16000})), /original mono PCM16/);
  for (const mutate of [
    r => { r.candidateModel = 'different-model'; },
    r => { r.runs.live.packetTimeline[1].afterStopMs = -500; },
    r => { r.runs.live.packetTimeline[0].durationMs = 0; },
    r => { r.runs.live.playbackEstimate.skippedLeadingMs += 0.01; },
    r => { r.runs.live.playbackEstimate.threshold = 1; },
  ]) {
    const altered = structuredClone(report); mutate(altered);
    assert.throws(() => replayLiveReport(altered, wav));
  }
});

test('offline output replay supports a long silent tail without relaxing source recording limits', () => {
  const raw = runWith([{atMs: 0, pcm: samples(100)}, {atMs: 2000, pcm: samples(35000, 0)}]);
  const report = {candidateModel: 'gpt-live-1', runs: {live: summarizeLive(raw)}};
  const wav = toWav(Buffer.concat(raw.packets.map(p => p.pcm)));
  assert.equal(analyzeLivePlayback(report, wav).profiles[0].afterSignalQueueGapCount, 1);
});
