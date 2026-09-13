// Streaming mono resampler. Keeps fractional sample boundaries across callbacks.
export class PcmRecorder {
  constructor(rate, emit) {
    this.ratio = rate / 24000; this.emit = emit;
    this.weight = 0; this.sum = 0; this.samples = [];
  }
  push(channel) {
    for (const sample of channel) {
      let remaining = 1;
      while (remaining > 1e-9) {
        const take = Math.min(remaining, this.ratio - this.weight);
        this.sum += sample * take; this.weight += take; remaining -= take;
        if (this.weight >= this.ratio - 1e-9) {
          const value = Math.max(-1, Math.min(1, this.sum / this.ratio));
          this.samples.push(Math.round(value * (value < 0 ? 32768 : 32767)));
          this.sum = 0; this.weight = 0;
          if (this.samples.length === 4800) this.flush();
        }
      }
    }
  }
  flush() {
    if (!this.samples.length) return;
    const bytes = new Uint8Array(this.samples.length * 2), view = new DataView(bytes.buffer);
    this.samples.forEach((v, i) => view.setInt16(i * 2, v, true));
    this.samples = []; this.emit(bytes);
  }
}

if (typeof AudioWorkletProcessor !== 'undefined') {
  class ComparisonRecorder extends AudioWorkletProcessor {
    constructor() {
      super(); this.active = true;
      this.recorder = new PcmRecorder(sampleRate, bytes => this.port.postMessage({ pcm: bytes }, [bytes.buffer]));
      this.port.onmessage = event => {
        if (event.data === 'stop') {
          this.active = false; this.recorder.flush(); this.port.postMessage({ stopped: true });
        }
      };
    }
    process(inputs) {
      // Output stays silent. Only the microphone input is sent to the models.
      if (this.active && inputs[0]?.[0]) this.recorder.push(inputs[0][0]);
      return this.active;
    }
  }
  registerProcessor('voice-comparison-recorder', ComparisonRecorder);
}
