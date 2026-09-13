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

export function toWav(pcm) {
  if (pcm.length % 2) throw new Error('Incomplete PCM16 sample.');
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24); header.writeUInt32LE(BYTES_PER_SECOND, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function summarize(run) {
  const {packets, stopMs, doneMs} = run;
  let next = 0, firstStart = null, firstSignal = null, totalAudioMs = 0;
  let hindsightStart = stopMs;
  const gaps = [];
  for (const packet of packets) {
    if (packet.pcm.length % 2) throw new Error('Incomplete output PCM16 sample.');
    const received = Math.max(stopMs, packet.atMs);
    const duration = packet.pcm.length / BYTES_PER_SECOND * 1000;
    // Reproduce the app's 150 ms initial queue and 50 ms refill threshold.
    // While the speaker is recording, received audio is held, not discarded.
    if (next === 0 || next < received + 50) {
      const start = received + 150;
      if (firstStart !== null && start > next) gaps.push(start - next);
      next = start;
    }
    firstStart ??= next;
    if (firstSignal === null) {
      for (let i = 0; i < packet.pcm.length; i += 2) {
        if (Math.abs(packet.pcm.readInt16LE(i)) > 256) {
          firstSignal = next + i / BYTES_PER_SECOND * 1000;
          break;
        }
      }
    }
    hindsightStart = Math.max(hindsightStart, packet.atMs - totalAudioMs);
    totalAudioMs += duration;
    next += duration;
  }
  return {
    status: packets.length ? 'audio_received' : 'no_audio',
    stopToFirstPacketMs: packets.length ? Math.max(0, packets[0].atMs - stopMs) : null,
    stopToFirstScheduledAudioMs: firstStart === null ? null : firstStart - stopMs,
    stopToFirstSignalEstimateMs: firstSignal === null ? null : firstSignal - stopMs,
    stopToCompleteMs: doneMs - stopMs,
    audioDurationMs: totalAudioMs,
    simulatedQueueGapCount: gaps.length,
    simulatedQueueGapMs: gaps,
    // An offline lower bound, not a buffer size the live client can know in advance.
    hindsightMinimumStartDelayMs: packets.length ? hindsightStart - stopMs : null,
    transcript: run.transcript,
    inputTranscript: run.inputTranscript,
    setupMs: run.setupMs,
    packetTimeline: packets.map(p => ({afterStopMs: p.atMs - stopMs, durationMs: p.pcm.length / BYTES_PER_SECOND * 1000})),
  };
}
