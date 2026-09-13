// Benchmark helpers only; the production app does not import this module.
export const SAMPLE_RATE = 24000;
export const BYTES_PER_SECOND = SAMPLE_RATE * 2;

export function readWav(wav) {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Input must be an uncompressed WAV file.');
  }
  const end = wav.readUInt32LE(4) + 8;
  if (end !== wav.length) throw new Error('Truncated or malformed WAV file.');
  let format, pcm;
  for (let offset = 12; offset < end;) {
    if (offset + 8 > end) throw new Error('Truncated WAV chunk header.');
    const size = wav.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > end) throw new Error('Truncated WAV chunk.');
    const name = wav.toString('ascii', offset, offset + 4);
    if (name === 'fmt ') {
      if (size < 16 || format) throw new Error('Invalid WAV format chunk.');
      format = [wav.readUInt16LE(start), wav.readUInt16LE(start + 2), wav.readUInt32LE(start + 4), wav.readUInt32LE(start + 8), wav.readUInt16LE(start + 12), wav.readUInt16LE(start + 14)];
    }
    if (name === 'data') {
      if (pcm) throw new Error('Multiple WAV data chunks are not supported.');
      pcm = wav.subarray(start, start + size);
    }
    offset = start + size + (size % 2);
    if (offset > end) throw new Error('Missing WAV chunk padding.');
  }
  if (JSON.stringify(format) !== JSON.stringify([1, 1, SAMPLE_RATE, BYTES_PER_SECOND, 2, 16])) {
    throw new Error('Use mono PCM16 little-endian WAV at 24000 Hz.');
  }
  if (!pcm?.length || pcm.length % 2 || pcm.length > BYTES_PER_SECOND * 30) {
    throw new Error('Use a nonempty clip of at most 30 seconds.');
  }
  return {pcm, durationMs: pcm.length / BYTES_PER_SECOND * 1000};
}

export function outputFormat(metadata = {}) {
  const format = metadata.format ?? 'pcm16';
  const sampleRate = metadata.sample_rate ?? 24000;
  const channels = metadata.channels ?? 1;
  if (format !== 'pcm16' || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || !Number.isInteger(channels) || channels < 1 || channels > 8) throw new Error('Unsupported output audio format.');
  return {format, sampleRate, channels, sampleRateDeclared: metadata.sample_rate !== undefined, channelsDeclared: metadata.channels !== undefined};
}

export function toWav(pcm, {sampleRate = SAMPLE_RATE, channels = 1} = {}) {
  outputFormat({sample_rate: sampleRate, channels});
  if (pcm.length % (2 * channels)) throw new Error('Incomplete PCM16 sample frame.');
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function summarize(run) {
  const {packets, stopMs, doneMs} = run;
  let next = 0, firstStart = null, firstSignal = null, totalAudioMs = 0;
  let hindsightStart = stopMs;
  let firstSignalPacket = null, zeroSamples = 0, sampleCount = 0;
  const gaps = [];
  for (const packet of packets) {
    const {sampleRate, channels} = packet.audioFormat ?? {sampleRate: SAMPLE_RATE, channels: 1};
    const bytesPerSecond = sampleRate * channels * 2;
    if (packet.pcm.length % (channels * 2)) throw new Error('Incomplete output PCM16 sample frame.');
    const received = Math.max(stopMs, packet.atMs);
    const duration = packet.pcm.length / bytesPerSecond * 1000;
    // Reproduce the app's 150 ms initial queue and 50 ms refill threshold.
    // While the speaker is recording, received audio is held, not discarded.
    if (next === 0 || next < received + 50) {
      const start = received + 150;
      if (firstStart !== null && start > next) gaps.push(start - next);
      next = start;
    }
    firstStart ??= next;
    for (let i = 0; i < packet.pcm.length; i += 2) {
      const value = packet.pcm.readInt16LE(i);
      sampleCount++;
      if (value === 0) zeroSamples++;
      if (firstSignal === null && Math.abs(value) > 256) {
        firstSignal = next + Math.floor(i / (channels * 2)) / sampleRate * 1000;
        firstSignalPacket = Math.max(0, packet.atMs - stopMs);
      }
    }
    hindsightStart = Math.max(hindsightStart, packet.atMs - totalAudioMs);
    totalAudioMs += duration;
    next += duration;
  }
  const zeroSampleFraction = sampleCount ? zeroSamples / sampleCount : null;
  const reviewWarnings = [];
  if (firstSignal === null) reviewWarnings.push('NO_SIGNAL_ABOVE_THRESHOLD');
  if (zeroSampleFraction !== null && zeroSampleFraction > 0.9) reviewWarnings.push('MOSTLY_DIGITAL_SILENCE');
  if (!run.transcript?.trim()) reviewWarnings.push('NO_OUTPUT_TRANSCRIPT');
  return {
    status: packets.length ? 'audio_received' : 'no_audio',
    qualityStatus: 'not_assessed', reviewWarnings, zeroSampleFraction,
    outputFormat: run.outputFormat ?? null,
    transport: run.transport ?? null,
    stopToFirstPacketMs: packets.length ? Math.max(0, packets[0].atMs - stopMs) : null,
    stopToFirstScheduledAudioMs: firstStart === null ? null : firstStart - stopMs,
    stopToFirstSignalEstimateMs: firstSignal === null ? null : firstSignal - stopMs,
    stopToFirstSignalPacketMs: firstSignalPacket,
    stopToCompleteMs: doneMs - stopMs,
    audioDurationMs: totalAudioMs,
    simulatedQueueGapCount: gaps.length,
    simulatedQueueGapMs: gaps,
    // An offline lower bound, not a buffer size the live client can know in advance.
    hindsightMinimumStartDelayMs: packets.length ? hindsightStart - stopMs : null,
    transcript: run.transcript,
    inputTranscript: run.inputTranscript,
    setupMs: run.setupMs,
    packetTimeline: packets.map(p => ({afterStopMs: p.atMs - stopMs, durationMs: p.pcm.length / ((p.audioFormat?.sampleRate ?? SAMPLE_RATE) * (p.audioFormat?.channels ?? 1) * 2) * 1000})),
  };
}
