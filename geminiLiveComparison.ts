// Owner comparison only. No production engine, glossary, or test answers are changed.
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { productionVoiceSession } from './voiceEngine.ts';

export const GEMINI_LIVE_MODEL = 'gemini-3.8-live';
export const GEMINI_LIVE_REVISION = 'manual-turn-2026-09-16';
export function pairedVoiceSession(source: string) {
  if (source !== 'ko' && source !== 'ja') throw Error('INVALID_LANGUAGE');
  const session = productionVoiceSession({ role: source === 'ko' ? 'user' : 'foreigner', foreignerLang: 'ja', ttsEnabled: true, opponentText: '' });
  session.max_output_tokens = 4096; // This comparison is bounded to 30 seconds, not the production five minutes.
  return session;
}
export function geminiLiveSetup(source: string) {
  return {
    model: `models/${GEMINI_LIVE_MODEL}`,
    generationConfig: { responseModalities: ['AUDIO'], maxOutputTokens: 4096,
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } },
    systemInstruction: { parts: [{ text: pairedVoiceSession(source).instructions }] },
    realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
    inputAudioTranscription: {}, outputAudioTranscription: {},
  };
}

function usage(raw: any) {
  const result: Record<string, any> = {};
  for (const key of ['promptTokenCount', 'responseTokenCount', 'totalTokenCount', 'cachedContentTokenCount', 'thoughtsTokenCount']) {
    if (Number.isSafeInteger(raw?.[key]) && raw[key] >= 0) result[key] = raw[key];
  }
  for (const key of ['promptTokensDetails', 'responseTokensDetails', 'cacheTokensDetails']) {
    if (Array.isArray(raw?.[key])) result[key] = raw[key].filter((v: any) =>
      ['TEXT', 'AUDIO', 'IMAGE', 'VIDEO'].includes(v?.modality) && Number.isSafeInteger(v.tokenCount) && v.tokenCount >= 0
    ).map((v: any) => ({ modality: v.modality, tokenCount: v.tokenCount }));
  }
  return result;
}

export function createGeminiLiveComparison(options: {
  source: string; key: string; connect: (url: string, options?: object) => WebSocket;
  ready: (evidence: Record<string, any>) => void;
  audio: (audio: string) => void; text: (input: string, output: string) => void;
  done: (error: string | undefined, evidence: Record<string, any>) => void;
  now?: () => number;
}) {
  const setup = geminiLiveSetup(options.source), now = options.now ?? (() => performance.now());
  const hash = createHash('sha256');
  let disposed = false, terminal = false, ready = false, active = false, origin: number | undefined;
  let inputBytes = 0, chunks = 0, audioBytes = 0, input = '', output = '';
  const marks: Record<string, number> = {};
  const evidence: Record<string, any> = {
    revision: GEMINI_LIVE_REVISION, requestedModel: GEMINI_LIVE_MODEL,
    promptSha256: createHash('sha256').update(setup.systemInstruction.parts[0].text).digest('hex'),
    requestedInputFormat: 'audio/pcm;rate=24000', requestedVoice: 'Kore', automaticActivityDetection: false,
    clock: 'Milliseconds since server received stop; excludes connection preparation. Not physical speaker latency.',
    marks, setupConfirmed: false, responseCompleted: false,
    modelVerification: 'Setup acknowledged; Google does not echo the model ID in setupComplete.',
  };
  const socket = options.connect('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=' + encodeURIComponent(options.key),
    { handshakeTimeout: 15000, maxPayload: 2_000_000, perMessageDeflate: false });
  const mark = (name: string) => { if (origin !== undefined) marks[name] ??= now() - origin; };
  const write = (event: object) => {
    if (disposed || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 500000) throw Error('GEMINI_LIVE_CONNECTION_FAILED');
    socket.send(JSON.stringify(event));
  };
  const finish = (error?: string) => {
    if (disposed || terminal) return;
    terminal = true; evidence.outputPcmBytes = audioBytes;
    evidence.transcriptionStatus = input.trim() ? 'received' : 'unavailable';
    options.done(error, evidence);
  };
  socket.on('open', () => { if (!disposed) { try { write({ setup }); } catch { finish('GEMINI_LIVE_CONNECTION_FAILED'); } } });
  socket.on('unexpected-response', (_req, response) => { response.resume(); finish(`GEMINI_LIVE_HTTP_${response.statusCode}`); });
  socket.on('error', () => finish('GEMINI_LIVE_CONNECTION_FAILED'));
  socket.on('close', (code: number) => { evidence.closeCode = code; finish('GEMINI_LIVE_DISCONNECTED'); });
  socket.on('message', raw => {
    if (disposed || terminal) return;
    try {
      const m = JSON.parse(raw.toString());
      if (m.error) { finish('GEMINI_LIVE_FAILED'); return; } // Never expose provider messages or key-bearing URLs.
      if (m.setupComplete) {
        if (ready) throw Error();
        ready = true; evidence.setupConfirmed = true; options.ready(evidence);
      }
      if (m.usageMetadata) evidence.usage = usage(m.usageMetadata);
      if (m.toolCall) { finish('GEMINI_LIVE_UNEXPECTED_TOOL'); return; }
      const content = m.serverContent;
      if (!content) return;
      if (!ready) throw Error();
      // Input transcription may arrive while listening. Output before explicit end is invalid.
      if (origin === undefined && (content.modelTurn || content.outputTranscription || content.turnComplete || content.generationComplete)) {
        finish('GEMINI_LIVE_EARLY_RESPONSE'); return;
      }
      if (content.interrupted) { finish('GEMINI_LIVE_INTERRUPTED'); return; }
      let textChanged = false;
      for (const [key, isInput] of [['inputTranscription', true], ['outputTranscription', false]] as const) {
        if (content[key]?.text !== undefined) {
          if (typeof content[key].text !== 'string') throw Error();
          if (isInput) input += content[key].text;
          else { output += content[key].text; mark('firstTranslation'); }
          textChanged = true;
        }
      }
      if (input.length > 32000 || output.length > 32000) throw Error();
      if (textChanged) options.text(input, output);
      for (const part of content.modelTurn?.parts ?? []) {
        if (!part.inlineData) continue;
        const { mimeType, data } = part.inlineData;
        if (typeof mimeType !== 'string' || !/^audio\/pcm;\s*rate=24000$/i.test(mimeType) ||
          typeof data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw Error();
        const pcm = Buffer.from(data, 'base64'); audioBytes += pcm.length;
        if (!pcm.length || pcm.length % 2 || audioBytes > 6_000_000) throw Error();
        mark('firstAudio'); options.audio(data);
      }
      if (content.generationComplete) mark('generationComplete');
      if (content.turnComplete) {
        mark('responseDone'); evidence.responseCompleted = true;
        if (!output.trim()) evidence.reviewWarnings = ['NO_OUTPUT_TRANSCRIPT'];
        finish(audioBytes ? undefined : 'GEMINI_LIVE_NO_AUDIO');
      }
    } catch { finish('GEMINI_LIVE_INVALID_RESPONSE'); }
  });
  return {
    append(pcm: Buffer) {
      if (!ready || terminal || origin !== undefined || !pcm.length || pcm.length % 2 || pcm.length > 9600 || inputBytes + pcm.length > 1_440_000) throw Error('GEMINI_LIVE_INVALID_INPUT');
      if (!active) { write({ realtimeInput: { activityStart: {} } }); active = true; }
      write({ realtimeInput: { audio: { data: pcm.toString('base64'), mimeType: 'audio/pcm;rate=24000' } } });
      hash.update(pcm); inputBytes += pcm.length; chunks++;
    },
    stop(originMs: number) {
      if (!ready || terminal || origin !== undefined || inputBytes < 4800) throw Error('GEMINI_LIVE_INPUT_TOO_SHORT');
      origin = originMs;
      Object.assign(evidence, { queuedPcmSha256: hash.digest('hex'), queuedPcmBytes: inputBytes, queuedChunks: chunks });
      mark('activityEndRequested'); write({ realtimeInput: { activityEnd: {} } });
      return { pcmSha256: evidence.queuedPcmSha256, bytes: inputBytes };
    },
    cancel() {
      if (disposed) return;
      disposed = true;
      if (socket.readyState === WebSocket.OPEN) socket.close();
      else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    },
  };
}
