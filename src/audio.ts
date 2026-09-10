let nextStartTime = 0;
let holdPlayback = false;
const audioQueue: string[] = [];
const activeSources = new Set<AudioBufferSourceNode>();

export function setHoldPlayback(hold: boolean, context: AudioContext) {
  holdPlayback = hold;
  if (!hold && audioQueue.length > 0) {
    const queueToPlay = [...audioQueue];
    audioQueue.length = 0; // clear queue
    queueToPlay.forEach(base64Audio => playAudioChunk(context, base64Audio));
  }
}

export function playAudioChunk(context: AudioContext, base64Audio: string) {
  if (holdPlayback) {
    audioQueue.push(base64Audio);
    return;
  }

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
    activeSources.add(source);
    source.onended = () => { activeSources.delete(source); source.disconnect(); };
    source.buffer = audioBuffer;
    source.connect(context.destination);
    
    // Play with minor jitter buffer to prevent choppiness
    if (nextStartTime === 0 || nextStartTime < context.currentTime + 0.05) {
      nextStartTime = context.currentTime + 0.15;
    }
    source.start(nextStartTime);
    nextStartTime += audioBuffer.duration;
  } catch (e) {
    console.error("Error playing audio chunk", e);
  }
}

export function resetAudioQueue() {
  for (const source of activeSources) {
    try { source.stop(); } catch { /* Already stopped. */ }
    source.disconnect();
  }
  activeSources.clear();
  nextStartTime = 0;
  audioQueue.length = 0;
}
