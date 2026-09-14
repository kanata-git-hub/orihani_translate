export type VoiceRole = 'user' | 'foreigner';
type Options = {
  role: VoiceRole; foreignerLang: string; ttsEnabled: boolean; opponentText: string;
  token: () => Promise<string>;
  levels: (levels: number[]) => void; stopped: () => void;
  audio: (audio: string) => void; text: (input: string, output: string) => void;
  done: () => void; guide: (pronunciation: string) => void; error: (code: string) => void;
};
const MAX_PCM_BYTES = 300 * 24000 * 2;

// One connection per utterance. The recorder always stops before commit/playback.
// PCM can accumulate during authentication, so speaking need not wait for the network.
export class RealtimeVoice {
  private options: Options;
  private ws?: WebSocket;
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private worklet?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private analyser?: AnalyserNode;
  private queue: Uint8Array[] = [];
  private bytes = 0;
  private closed = false;
  private stopping = false;
  private flushed = false;
  private ready = false;
  private committed = false;
  private completed = false;
  private maxTimer?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private pumpTimer?: ReturnType<typeof setTimeout>;
  private visualizer?: ReturnType<typeof setInterval>;

  constructor(options: Options) {
    this.options = options;
    this.maxTimer = setTimeout(() => this.stop(), 300000);
    this.deadline = setTimeout(() => this.fail('CONNECTION_TIMEOUT'), 45000);
    void this.connect();
    void this.capture();
  }
  private async connect() {
    try {
      const token = await this.options.token();
      if (this.closed) return;
      const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${scheme}//${location.host}/voice`);
      this.ws = ws;
      ws.onopen = () => {
        if (this.closed) { ws.close(); return; }
        const { role, foreignerLang, ttsEnabled, opponentText } = this.options;
        ws.send(JSON.stringify({ type: 'auth', token, role, foreignerLang, ttsEnabled, opponentText }));
      };
      ws.onerror = () => this.fail('CONNECTION_FAILED');
      ws.onclose = () => { if (!this.closed) this.completed ? this.cancel() : this.fail('DISCONNECTED'); };
      ws.onmessage = event => {
        if (this.closed) return;
        try {
          const m = JSON.parse(event.data);
          if (m.type === 'error') { this.fail(m.code); return; }
          if (m.type === 'ready') {
            if (this.ready || m.maxSeconds !== 300) throw Error();
            this.ready = true; clearTimeout(this.deadline); this.pump();
          } else if (m.type === 'audio') {
            if (!this.committed || !this.flushed || typeof m.audio !== 'string') throw Error();
            this.options.audio(m.audio);
          } else if (m.type === 'text' || m.type === 'done') {
            if (!this.committed || typeof m.input !== 'string' || typeof m.output !== 'string') throw Error();
            this.options.text(m.input, m.output);
            if (m.type === 'done' && !this.completed) {
              this.completed = true; clearTimeout(this.deadline);
              this.deadline = setTimeout(() => this.cancel(), 25000);
              this.options.done();
            }
          } else if (m.type === 'guide') {
            if (!this.completed || typeof m.pronunciation !== 'string') throw Error();
            this.options.guide(m.pronunciation);
          } else if (m.type === 'finished') {
            if (!this.completed) throw Error();
            this.cancel();
          }
        } catch { this.fail('INVALID_RESPONSE'); }
      };
    } catch { this.fail('CONNECTION_FAILED'); }
  }
  private async capture() {
    try {
      // Construct/resume directly in the tap gesture, before asynchronous permission work.
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass() as AudioContext;
      this.ctx = ctx;
      void ctx.resume().catch(() => this.fail('MICROPHONE_FAILED'));
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      if (this.closed) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      await ctx.audioWorklet.addModule('/voice-compare-recorder.mjs');
      if (this.closed) return;
      const source = ctx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(ctx, 'voice-comparison-recorder');
      this.source = source; this.worklet = worklet;
      worklet.port.onmessage = event => {
        if (this.closed || this.flushed) return;
        if (event.data.pcm instanceof Uint8Array) {
          const pcm = event.data.pcm.slice(0, MAX_PCM_BYTES - this.bytes);
          if (pcm.length) { this.bytes += pcm.length; this.queue.push(pcm); this.pump(); }
          if (this.bytes === MAX_PCM_BYTES && !this.stopping) this.stop();
        }
        if (event.data.stopped) {
          clearTimeout(this.flushTimer); this.flushed = true;
          this.releaseCapture(); this.pump();
        }
      };
      // The worklet outputs zeros, so the microphone is never played through the speaker.
      source.connect(worklet); worklet.connect(ctx.destination);
      const analyser = ctx.createAnalyser(); analyser.fftSize = 64;
      this.analyser = analyser; source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      this.visualizer = setInterval(() => {
        analyser.getByteFrequencyData(data);
        this.options.levels(Array.from({ length: 15 }, (_, i) => Math.max(8, Math.min(100, data[i * 2] / 255 * 150))));
      }, 80);
      stream.getTracks().forEach(track => { track.onended = () => { if (!this.stopping) this.stop(); }; });
    } catch { this.fail('MICROPHONE_FAILED'); }
  }
  private pump() {
    if (this.closed || !this.ready || this.committed || this.pumpTimer) return;
    if (this.ws?.readyState !== WebSocket.OPEN) { this.fail('CONNECTION_FAILED'); return; }
    if (this.queue.length && this.ws.bufferedAmount < 128000) {
      const pcm = this.queue.shift()!;
      const audio = btoa(String.fromCharCode(...pcm));
      this.ws.send(JSON.stringify({ type: 'pcm', audio }));
    }
    if (this.queue.length) {
      // Drain a connection-start backlog gradually; never drop recorded chunks.
      this.pumpTimer = setTimeout(() => { this.pumpTimer = undefined; this.pump(); }, 20);
    } else if (this.flushed) {
      if (this.bytes < 4800) { this.fail('NO_SPEECH_DETECTED'); return; }
      this.committed = true;
      this.ws.send(JSON.stringify({ type: 'stop' }));
      clearTimeout(this.deadline);
      this.deadline = setTimeout(() => this.fail('RESPONSE_TIMEOUT'), 200000);
    }
  }
  stop() {
    if (this.closed || this.stopping) return;
    this.stopping = true; clearTimeout(this.maxTimer); clearInterval(this.visualizer);
    // Stop hardware capture immediately, then flush the worklet's final partial PCM packet.
    this.stream?.getTracks().forEach(track => track.stop());
    this.options.stopped();
    if (!this.worklet) { this.fail('NO_SPEECH_DETECTED'); return; }
    this.flushTimer = setTimeout(() => this.fail('MICROPHONE_FLUSH_FAILED'), 2000);
    this.worklet.port.postMessage('stop');
  }
  private releaseCapture() {
    clearInterval(this.visualizer);
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined;
    this.source?.disconnect(); this.source = undefined;
    this.analyser?.disconnect(); this.analyser = undefined;
    if (this.worklet) { this.worklet.port.onmessage = null; this.worklet.disconnect(); this.worklet = undefined; }
    if (this.ctx) { void this.ctx.close().catch(() => {}); this.ctx = undefined; }
  }
  private fail(code: string) {
    if (this.closed) return;
    this.cancel(); this.options.error(code);
  }
  cancel() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.maxTimer); clearTimeout(this.deadline); clearTimeout(this.flushTimer); clearTimeout(this.pumpTimer);
    this.releaseCapture(); this.queue = [];
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'cancel' }));
      this.ws.close(); this.ws = undefined;
    }
  }
}
