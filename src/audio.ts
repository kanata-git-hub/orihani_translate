export function pcmToBase64(pcmData: Float32Array, sampleRate: number): string {
  // Downsample to 16000Hz if needed
  const targetRate = 16000;
  let resampledData = pcmData;
  if (sampleRate !== targetRate) {
    const ratio = sampleRate / targetRate;
    const newLength = Math.round(pcmData.length / ratio);
    resampledData = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
       resampledData[i] = pcmData[Math.round(i * ratio)];
    }
  }

  const buffer = new ArrayBuffer(resampledData.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < resampledData.length; i++) {
    const s = Math.max(-1, Math.min(1, resampledData[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

let nextStartTime = 0;
export function playAudioChunk(context: AudioContext, base64Audio: string) {
  try {
    const binary = atob(base64Audio);
    const buffer = new ArrayBuffer(binary.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) {
      view[i] = binary.charCodeAt(i);
    }
    
    // We expect 16-bit PCM at 24kHz.
    const int16Array = new Int16Array(buffer);
    const audioBuffer = context.createBuffer(1, int16Array.length, 24000);
    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < int16Array.length; i++) {
      channelData[i] = int16Array[i] / 0x8000;
    }
    
    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);
    
    if (nextStartTime < context.currentTime) {
      nextStartTime = context.currentTime + 0.1; // minor buffer
    }
    source.start(nextStartTime);
    nextStartTime += audioBuffer.duration;
  } catch (e) {
    console.error("Error playing audio chunk", e);
  }
}

export function resetAudioQueue() {
  nextStartTime = 0;
}
