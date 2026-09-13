import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import WebSocket from 'ws';
import {readWav, toWav, summarize, outputFormat, BYTES_PER_SECOND} from './core.mjs';
import {generateSyntheticInput, SYNTHETIC_CASES} from './synthetic.mjs';

const OPENAI_URL = 'wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate';
const BASELINE_URL = 'wss://orihani-translate-610824131458.asia-northeast1.run.app/live';
const INPUT_TRANSCRIPTION_MODEL = 'gpt-realtime-whisper';
const DIAGNOSTIC_EVENTS = new Set(['session.created', 'session.updated', 'session.input_transcript.delta', 'session.output_transcript.delta', 'session.output_audio.delta', 'session.closed', 'error']);
// Intersection of the current app's configured languages and OpenAI output languages.
const LANGUAGES = new Set(['ko', 'ja', 'en', 'es', 'fr', 'zh', 'de', 'it']);

// No changes to app routes, prompts, model selection or microphone playback.
export function collect({provider, wav, source, target, key, baselineUrl = BASELINE_URL, diagnoseInput = false,
  socketFactory = (url, options) => new WebSocket(url, options), timeoutMs = 75000}) {
  const {pcm, durationMs} = readWav(wav);
  if (!LANGUAGES.has(source) || !LANGUAGES.has(target) || (source !== 'ko' && target !== 'ko') || source === target) {
    throw new Error('Compare Korean to/from a supported target language.');
  }
  if (provider !== 'openai' && provider !== 'baseline') throw new Error('Unknown provider.');
  if (diagnoseInput && provider !== 'openai') throw new Error('Input diagnosis supports OpenAI only.');
  if (provider === 'openai' && !key) throw new Error('OPENAI_API_KEY is not connected.');
  return new Promise((resolve, reject) => {
    const connectedAt = performance.now();
    const now = () => performance.now() - connectedAt;
    const run = {packets: [], transcript: '', inputTranscript: '', stopMs: null, doneMs: null, setupMs: null,
      outputFormat: null, transport: {inputPcmSha256: createHash('sha256').update(pcm).digest('hex'), inputPcmBytes: pcm.length,
        inputChunkMs: provider === 'openai' ? 200 : null, queuedPcmBytes: 0, queuedChunks: 0, serverSession: null, closeRequested: false, closeConfirmed: false,
        inputTranscriptionModelRequested: diagnoseInput ? INPUT_TRANSCRIPTION_MODEL : null, serverEventCounts: {}}};
    const queuedHash = createHash('sha256');
    let settled = false, streaming = false;
    const ws = socketFactory(provider === 'openai' ? OPENAI_URL : baselineUrl,
      provider === 'openai' ? {headers: {Authorization: `Bearer ${key}`}} : {});
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      run.doneMs = now();
      if (error) {
        // Preserve source transcript and safe configuration evidence even on a later failure.
        if (diagnoseInput) error.partialRun = run;
        ws.terminate(); reject(error);
      }
      else { ws.close(); resolve(run); }
    };
    const timer = setTimeout(() => finish(new Error('Timed out; incomplete output must not count as a successful run.')), timeoutMs);
    const send = value => ws.send(JSON.stringify(value));
    const appendPacket = (encoded, metadata = {}) => {
      const bytes = Buffer.from(encoded, 'base64');
      const audioFormat = outputFormat({format: metadata.format ?? run.outputFormat?.format,
        sample_rate: metadata.sample_rate ?? run.outputFormat?.sampleRate, channels: metadata.channels ?? run.outputFormat?.channels});
      audioFormat.sampleRateDeclared = Boolean(run.outputFormat?.sampleRateDeclared || metadata.sample_rate !== undefined);
      audioFormat.channelsDeclared = Boolean(run.outputFormat?.channelsDeclared || metadata.channels !== undefined);
      if (!bytes.length || bytes.length % (2 * audioFormat.channels)) throw new Error('Invalid output PCM16 audio.');
      if (run.outputFormat && (run.outputFormat.sampleRate !== audioFormat.sampleRate || run.outputFormat.channels !== audioFormat.channels)) throw new Error('Output audio format changed within one stream; refusing to write a mislabeled WAV.');
      run.outputFormat = audioFormat;
      run.packets.push({atMs: now(), pcm: bytes, audioFormat});
    };
    async function stream() {
      if (streaming || settled) return;
      streaming = true; run.setupMs = now();
      const start = now(), chunkBytes = BYTES_PER_SECOND / 5;
      for (let offset = 0; offset < pcm.length; offset += chunkBytes) {
        // Send each frame only after its samples would have been captured by a live microphone.
        await delay(Math.max(0, start + Math.min(offset + chunkBytes, pcm.length) / BYTES_PER_SECOND * 1000 - now()));
        if (settled) return;
        const chunk = pcm.subarray(offset, offset + chunkBytes);
        send({type: 'session.input_audio_buffer.append', audio: chunk.toString('base64')});
        queuedHash.update(chunk); run.transport.queuedPcmBytes += chunk.length; run.transport.queuedChunks++;
      }
      await delay(Math.max(0, start + durationMs - now()));
      if (settled) return;
      run.stopMs = now();
      run.transport.queuedPcmSha256 = queuedHash.digest('hex');
      run.transport.closeRequested = true;
      // Flush the utterance and receive ALL remaining audio before closing.
      send({type: 'session.close'});
    }
    ws.on('open', () => {
      if (provider === 'openai') {
        send({type: 'session.update', session: {audio: {input: {noise_reduction: null,
          ...(diagnoseInput ? {transcription: {model: INPUT_TRANSCRIPTION_MODEL}} : {})}, output: {language: target}}}});
      } else {
        run.setupMs = now(); run.stopMs = now();
        send({type: 'process_audio', role: source === 'ko' ? 'user' : 'foreigner',
          audio: wav.toString('base64'), mimeType: 'audio/wav',
          previousText: '', opponentText: '', targetLanguageCode: target,
          foreignerLang: source === 'ko' ? target : source, ttsEnabled: true});
      }
    });
    ws.on('message', data => {
      if (settled) return;
      try {
        const event = JSON.parse(data.toString());
        if (provider === 'openai' && DIAGNOSTIC_EVENTS.has(event.type)) {
          run.transport.serverEventCounts[event.type] = (run.transport.serverEventCounts[event.type] ?? 0) + 1;
        }
        if (event.error || event.type === 'error') {
          const code = typeof event.error === 'string' ? event.error : event.error?.code || 'provider_error';
          throw new Error(`${provider}: ${code}`);
        }
        if (provider === 'openai') {
          if (event.type === 'session.updated') {
            if (diagnoseInput && !event.session) throw new Error('Server did not confirm the input transcription configuration.');
            if (event.session) {
              const session = event.session;
              run.transport.serverSession = {model: session.model, type: session.type, targetLanguage: session.audio?.output?.language,
                inputTranscriptionModel: session.audio?.input?.transcription?.model ?? null};
              if (session.model !== 'gpt-realtime-translate' || session.type !== 'translation' || session.audio?.output?.language !== target) throw new Error('Server translation session does not match the requested model or language.');
              if (diagnoseInput && session.audio?.input?.transcription?.model !== INPUT_TRANSCRIPTION_MODEL) throw new Error('Server did not confirm the requested input transcription model.');
            }
            void stream().catch(finish);
          }
          if (event.type === 'session.output_audio.delta') appendPacket(event.delta, event);
          if (event.type === 'session.output_transcript.delta') run.transcript += event.delta;
          if (event.type === 'session.input_transcript.delta') {
            if (typeof event.delta !== 'string') throw new Error('Invalid source transcript delta.');
            run.inputTranscript += event.delta;
          }
          if (event.type === 'session.closed') {
            if (run.stopMs === null) throw new Error('Translation session closed before the input finished.');
            run.transport.closeConfirmed = true;
            finish();
          }
        } else {
          if (event.audio) appendPacket(event.audio);
          if (event.outputTranscription !== undefined) run.transcript = event.outputTranscription;
          if (event.inputTranscription !== undefined) run.inputTranscript = event.inputTranscription;
          if (event.turnComplete) finish();
        }
      } catch (error) { finish(error); }
    });
    ws.on('error', () => finish(new Error(`${provider}: connection failed (check access, key and network).`)));
    ws.on('close', () => { if (!settled) finish(new Error(`${provider}: connection closed before output completed.`)); });
  });
}

async function main() {
  const {values} = parseArgs({options: {audio: {type: 'string'}, synthetic: {type: 'boolean'}, source: {type: 'string'}, target: {type: 'string'}, provider: {type: 'string'}, run: {type: 'boolean'}, 'openai-first': {type: 'boolean'}, 'diagnose-input': {type: 'boolean'}}});
  if (Boolean(values.audio) === Boolean(values.synthetic) || !values.source || !values.target) throw new Error('Usage: node scripts/voice-benchmark/run.mjs (--audio input.wav | --synthetic) --source ko --target ja [--run]');
  if (!LANGUAGES.has(values.source) || !LANGUAGES.has(values.target) || (values.source !== 'ko' && values.target !== 'ko') || values.source === values.target) throw new Error('Compare Korean to/from a supported target language.');
  if (values.synthetic && (!Object.hasOwn(SYNTHETIC_CASES, values.source) || !Object.hasOwn(SYNTHETIC_CASES, values.target))) throw new Error('Synthetic comparison supports Korean and Japanese only.');
  if (values.provider && values.provider !== 'openai') throw new Error('The optional provider filter supports openai only.');
  const diagnoseInput = Boolean(values['diagnose-input']);
  if (diagnoseInput && (values.provider !== 'openai' || !values.audio || values.synthetic)) throw new Error('Input diagnosis requires --provider openai and an existing --audio file.');
  const key = process.env.OPENAI_API_KEY;
  let wav = values.audio ? await fs.readFile(values.audio) : null;
  if (!values.run) {
    console.log(JSON.stringify({status: 'preflight_only', providerFilter: values.provider ?? 'both', inputTranscriptionModel: diagnoseInput ? INPUT_TRANSCRIPTION_MODEL : null, durationMs: wav ? readWav(wav).durationMs : null, inputKind: values.synthetic ? 'synthetic' : 'provided_audio', sampleText: values.synthetic ? SYNTHETIC_CASES[values.source].text : undefined, openaiKeyAvailable: Boolean(key), willCallPaidApis: false}));
    return;
  }
  // Fail before either provider is called if the comparison cannot run.
  if (!key) throw new Error('OPENAI_API_KEY is not connected. No paid API calls were made.');
  let inputSource = {kind: 'provided_audio'};
  if (values.synthetic) {
    console.log('Creating AI-generated test speech (one additional OpenAI TTS request; excluded from translation timing).');
    const generated = await generateSyntheticInput({source: values.source, key});
    wav = generated.wav; inputSource = generated.provenance;
  }
  const {durationMs} = readWav(wav);
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results', new Date().toISOString().replace(/[:.]/g, '-'));
  await fs.mkdir(out, {recursive: true, mode: 0o700});
  await fs.writeFile(path.join(out, 'source.wav'), wav, {mode: 0o600});
  const report = {measuredAt: new Date().toISOString(), source: values.source, target: values.target,
    purpose: diagnoseInput ? 'input_diagnostic' : 'benchmark',
    inputTranscriptionModel: diagnoseInput ? INPUT_TRANSCRIPTION_MODEL : null,
    sourceSha256: createHash('sha256').update(wav).digest('hex'), sourceDurationMs: durationMs, inputSource,
    baselineModels: ['gemini-3.6-flash', 'gemini-3.1-flash-tts-preview'], candidateModel: 'gpt-realtime-translate', providerFilter: values.provider ?? 'both',
    method: 'Ready connections. Selected providers only: Gemini receives full WAV after stop; OpenAI receives identical PCM in 200 ms frames in real time while playback is held until stop. No prior conversation context. Latency is measured from this machine, not a phone.',
    limits: 'Queue metrics simulate app scheduling; they do not prove gapless audible speech. Listen to output WAVs and test a real phone before switching. Hindsight buffering is an offline lower bound. No quality score is assigned automatically.' + (diagnoseInput ? ' Source transcription is a separate model, not proof of what the translation model understood. This diagnostic adds transcription cost and is not a fair latency comparison.' : ''),
    runs: {}};
  for (const provider of values.provider ? [values.provider] : values['openai-first'] ? ['openai', 'baseline'] : ['baseline', 'openai']) {
    try {
      const result = await collect({provider, wav, source: values.source, target: values.target, key, diagnoseInput});
      report.runs[provider] = summarize(result);
      await fs.writeFile(path.join(out, `${provider}.wav`), toWav(Buffer.concat(result.packets.map(p => p.pcm)), result.outputFormat ?? {}), {mode: 0o600});
    } catch (error) {
      report.runs[provider] = {status: 'failed', error: String(error.message).split(key).join('[redacted]')};
      if (diagnoseInput && error.partialRun) {
        const partial = error.partialRun;
        report.runs[provider].diagnosticPartial = {inputTranscript: partial.inputTranscript, transcript: partial.transcript, transport: partial.transport};
      }
      process.exitCode = 1;
    }
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2), {mode: 0o600});
    console.log(`${provider}: ${report.runs[provider].status}`);
    if (report.runs[provider].status === 'audio_received') {
      console.log('음성 데이터 수신 완료입니다. 번역 품질 통과를 뜻하지 않습니다.');
      if (report.runs[provider].reviewWarnings?.length) console.log(`검토 경고: ${report.runs[provider].reviewWarnings.join(', ')}`);
    }
    if (diagnoseInput) {
      const result = report.runs[provider], evidence = result.diagnosticPartial ?? result;
      const printable = value => JSON.stringify(value).split(key).join('[redacted]');
      console.log(`원음 받아쓰기 (별도 모델): ${printable(evidence.inputTranscript ?? '')}`);
      console.log(`번역문 (${values.target}): ${printable(evidence.transcript ?? '')}`);
      console.log(`입력 진단 기록: ${printable({status: result.status, error: result.error ?? null, transport: evidence.transport ?? null})}`);
      console.log('받아쓰기의 정확성은 사람이 확인해야 합니다. 빈 결과만으로 원음 미전송을 확정할 수는 없습니다.');
    }
  }
  console.log(`Private benchmark results: ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
