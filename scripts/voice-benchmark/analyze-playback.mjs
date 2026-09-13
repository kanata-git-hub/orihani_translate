// Offline only: no network modules, keys, API calls, or writes to input files.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {toWav, summarize, SAMPLE_RATE} from './core.mjs';

export function replayLiveReport(report, wav) {
  const run = report.runs?.live, gate = run?.playbackEstimate;
  if (report.candidateModel !== 'gpt-live-1' || run?.status !== 'audio_received' || !gate || gate.threshold !== 256 || gate.preRollMs !== 200 ||
    run.outputFormat?.sampleRate !== SAMPLE_RATE || run.outputFormat?.channels !== 1 || run.outputFormat?.format !== 'pcm16') {
    throw new Error('Use a successful GPT-Live benchmark report with the original playback gate.');
  }
  // Accept the exact canonical WAV layout written by live.mjs, including recordings
  // longer than the 30 s source limit. Reject edited/container-mismatched files.
  if (wav.length < 44 || !toWav(wav.subarray(44)).equals(wav)) throw new Error('Use the original mono PCM16 24 kHz live.wav.');
  const pcm = wav.subarray(44), skipFloat = gate.skippedLeadingMs * SAMPLE_RATE / 1000, skip = Math.round(skipFloat);
  if (!Number.isFinite(skipFloat) || skip < 0 || Math.abs(skip - skipFloat) > 0.001 || !Array.isArray(run.packetTimeline) || !run.packetTimeline.length) throw new Error('Invalid playback timeline.');
  const detected = run.stopToFirstSignalPacketMs;
  if (detected !== null && (!Number.isFinite(detected) || detected < 0)) throw new Error('Invalid signal detection time.');
  let rawOffset = 0, outputOffset = 0, lastReceived = -Infinity;
  const packets = [];
  for (const packet of run.packetTimeline) {
    const exactFrames = packet.durationMs * SAMPLE_RATE / 1000, frames = Math.round(exactFrames);
    if (!Number.isFinite(packet.afterStopMs) || packet.afterStopMs < lastReceived || !Number.isFinite(exactFrames) || frames <= 0 || Math.abs(frames - exactFrames) > 0.001) throw new Error('Invalid packet timing.');
    lastReceived = packet.afterStopMs;
    const keptFrames = Math.max(0, rawOffset + frames - Math.max(rawOffset, skip));
    rawOffset += frames;
    if (!keptFrames) continue;
    const end = outputOffset + keptFrames * 2;
    if (end > pcm.length) throw new Error('Report and live.wav lengths do not match.');
    packets.push({pcm: pcm.subarray(outputOffset, end), atMs: Math.max(0, packet.afterStopMs, detected ?? 0), audioFormat: run.outputFormat});
    outputOffset = end;
  }
  if (outputOffset !== pcm.length || !outputOffset) throw new Error('Report and live.wav lengths do not match.');
  return {packets, stopMs: 0, doneMs: run.stopToSessionClosedMs, transcript: run.transcript, inputTranscript: run.inputTranscript, outputFormat: run.outputFormat};
}

export function analyzeLivePlayback(report, wav) {
  const run = replayLiveReport(report, wav);
  return {candidateModel: report.candidateModel, sourceSha256: report.sourceSha256, paidApiCalls: 0,
    limits: 'Offline packet replay, not phone playback or listening assessment. The amplitude span is not a speech recognizer. Timing/length consistency does not cryptographically authenticate the WAV. Buffer choices evaluated on one recording do not guarantee future performance. No audio is edited.',
    profiles: [150, 300, 500].map(initialBufferMs => {
      const result = summarize(run, {initialBufferMs});
      return {initialBufferMs, refillThresholdMs: 50, stopToFirstSignalEstimateMs: result.stopToFirstSignalEstimateMs,
        signalRangeMs: result.signalRangeMs, totalQueueGapCount: result.simulatedQueueGapCount,
        signalSpanQueueGapCount: result.signalSpanQueueGapCount, afterSignalQueueGapCount: result.afterSignalQueueGapCount,
        gapDetails: result.simulatedQueueGapDetails};
    })};
}

async function main() {
  const {values} = parseArgs({options: {report: {type: 'string'}, audio: {type: 'string'}}});
  if (!values.report || !values.audio) throw new Error('Usage: node scripts/voice-benchmark/analyze-playback.mjs --report report.json --audio live.wav');
  const [report, wav] = await Promise.all([fs.readFile(values.report, 'utf8'), fs.readFile(values.audio)]);
  console.log(JSON.stringify(analyzeLivePlayback(JSON.parse(report), wav), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
