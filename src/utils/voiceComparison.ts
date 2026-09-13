export const RATE = 24000;
export function concatPcm(parts: Uint8Array[]) {
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
export function encodePcm(bytes: Uint8Array) {
  let text = ''; for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return btoa(text);
}
export function decodePcm(text: string) { return Uint8Array.from(atob(text), c => c.charCodeAt(0)); }
export function wavBytes(pcm: Uint8Array) {
  const bytes = new Uint8Array(pcm.length + 44), v = new DataView(bytes.buffer);
  const write = (offset: number, text: string) => [...text].forEach((c, i) => bytes[offset + i] = c.charCodeAt(0));
  write(0, 'RIFF'); v.setUint32(4, pcm.length + 36, true); write(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); write(36, 'data'); v.setUint32(40, pcm.length, true); bytes.set(pcm, 44);
  return bytes;
}
export function signalRange(pcm: Uint8Array, threshold = 256) {
  const v = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let first: number | null = null, last: number | null = null;
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    if (Math.abs(v.getInt16(i, true)) > threshold) { first ??= i / 2; last = i / 2; }
  }
  return { first, last };
}
export function leadingSkip(pcm: Uint8Array) {
  const { first } = signalRange(pcm);
  return first === null ? null : Math.max(0, first - RATE / 5) * 2;
}

// The two queues run on the same browser audio clock; only the selected one is audible.
// Metrics are scheduled browser playback, not a physical speaker measurement.
export class ComparisonPlayer {
  context: AudioContext;
  gain: GainNode;
  raw: Uint8Array[] = [];
  packets: { receivedAtMs: number; bytes: number }[] = [];
  playable: Uint8Array[] = [];
  nodes = new Set<AudioBufferSourceNode>();
  stoppedAt: number | null = null;
  firstPacketAt: number | null = null;
  firstSignalAt: number | null = null;
  skipBytes: number | null = null;
  scheduledBytes = 0;
  private scheduledParts = 0;
  private rawBytes = 0;
  private playableSamples = 0;
  private range: { first: number | null; last: number | null } = { first: null, last: null };
  next = 0;
  gaps: { atSample: number; ms: number }[] = [];
  audioClockInterrupted = false;
  constructor(context: AudioContext, audible: boolean) {
    this.context = context; this.gain = context.createGain(); this.gain.gain.value = audible ? 1 : 0;
    this.gain.connect(context.destination);
  }
  receive(pcm: Uint8Array, at = performance.now()) {
    const packetRange = signalRange(pcm);
    this.raw.push(pcm); this.packets.push({ receivedAtMs: at, bytes: pcm.length });
    const previousBytes = this.rawBytes; this.rawBytes += pcm.length;
    if (this.firstPacketAt === null && packetRange.first !== null) this.firstPacketAt = at;
    let playable = pcm;
    if (this.skipBytes === null) {
      if (packetRange.first === null) return;
      this.skipBytes = Math.max(0, previousBytes + packetRange.first * 2 - RATE / 5 * 2);
      playable = concatPcm(this.raw).slice(this.skipBytes);
    }
    const range = signalRange(playable);
    if (range.first !== null) {
      this.range.first ??= this.playableSamples + range.first;
      this.range.last = this.playableSamples + range.last!;
    }
    this.playableSamples += playable.length / 2; this.playable.push(playable);
    this.schedule();
  }
  release(stoppedAt: number) { this.stoppedAt = stoppedAt; this.schedule(); }
  schedule() {
    if (this.stoppedAt === null) return;
    if (this.context.state !== 'running') { this.audioClockInterrupted = true; return; }
    if (this.scheduledParts === this.playable.length) return;
    const pcm = concatPcm(this.playable.slice(this.scheduledParts)), view = new DataView(pcm.buffer);
    this.scheduledParts = this.playable.length;
    const buffer = this.context.createBuffer(1, pcm.length / 2, RATE), data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = view.getInt16(i * 2, true) / 32768;
    const current = this.context.currentTime;
    let start = this.next;
    if (!start || start < current + 0.05) start = current + 0.15;
    if (this.next && start > this.next) this.gaps.push({ atSample: this.scheduledBytes / 2, ms: (start - this.next) * 1000 });
    const first = signalRange(pcm).first;
    if (this.firstSignalAt === null && first !== null) this.firstSignalAt = performance.now() + (start - current + first / RATE) * 1000;
    const node = this.context.createBufferSource(); node.buffer = buffer; node.connect(this.gain);
    this.nodes.add(node); node.onended = () => { this.nodes.delete(node); node.disconnect(); };
    node.start(start); this.next = start + buffer.duration; this.scheduledBytes += pcm.length;
  }
  metrics() {
    const range = this.range;
    const speechGaps = this.gaps.filter(g => range.first !== null && g.atSample > range.first && g.atSample <= range.last!);
    return {
      stopToFirstSignalPacketMs: this.stoppedAt === null || this.firstPacketAt === null ? null : this.firstPacketAt - this.stoppedAt,
      stopToScheduledSpeechMs: this.stoppedAt === null || this.firstSignalAt === null ? null : this.firstSignalAt - this.stoppedAt,
      signalSpanQueueGapsMs: speechGaps.map(g => g.ms), allQueueGaps: this.gaps,
      skippedLeadingMs: this.skipBytes === null ? null : this.skipBytes / 48,
      firstSignalSample: range.first, lastSignalSample: range.last, audioClockInterrupted: this.audioClockInterrupted,
      threshold: 256, preRollMs: 200, initialBufferMs: 150, packets: this.packets,
    };
  }
  cancel() {
    for (const node of this.nodes) { try { node.stop(); } catch {} node.disconnect(); }
    this.nodes.clear(); this.gain.disconnect();
  }
}
