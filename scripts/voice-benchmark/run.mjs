import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import WebSocket from 'ws';
import {readWav, toWav, summarize, BYTES_PER_SECOND} from './core.mjs';
import {generateSyntheticInput, SYNTHETIC_CASES} from './synthetic.mjs';

const OPENAI_URL = 'wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate';
const BASELINE_URL = 'wss://orihani-translate-610824131458.asia-northeast1.run.app/live';
// Intersection of the current app's configured languages and OpenAI output languages.
const LANGUAGES = new Set(['ko', 'ja', 'en', 'es', 'fr', 'zh', 'de', 'it']);

// No changes to app routes, prompts, model selection or microphone playback.
export function collect({provider, wav, source, target, key, baselineUrl = BASELINE_URL,
  socketFactory = (url, options) => new WebSocket(url, options), timeoutMs = 75000}) {
  const {pcm, durationMs} = readWav(wav);
  if (!LANGUAGES.has(source) || !LANGUAGES.has(target) || (source !== 'ko' && target !== 'ko') || source === target) {
    throw new Error('Compare Korean to/from a supported target language.');
  }
  if (provider !== 'openai' && provider !== 'baseline') throw new Error('Unknown provider.');
  if (provider === 'openai' && !key) throw new Error('OPENAI_API_KEY is not connected.');
  return new Promise((resolve, reject) => {
    const connectedAt = performance.now();
    const now = () => performance.now() - connectedAt;
    const run = {packets: [], transcript: '', inputTranscript: '', stopMs: null, doneMs: null, setupMs: null};
    let settled = false, streaming = false;
    const ws = socketFactory(provider === 'openai' ? OPENAI_URL : baselineUrl,
      provider === 'openai' ? {headers: {Authorization: `Bearer ${key}`}} : {});
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      run.doneMs = now();
      if (error) { ws.terminate(); reject(error); }
      else { ws.close(); resolve(run); }
    };
    const timer = setTimeout(() => finish(new Error('Timed out; incomplete output must not count as a successful run.')), timeoutMs);
    const send = value => ws.send(JSON.stringify(value));
    const appendPacket = encoded => {
      const bytes = Buffer.from(encoded, 'base64');
      if (!bytes.length || bytes.length % 2) throw new Error('Invalid output PCM16 audio.');
      run.packets.push({atMs: now(), pcm: bytes});
    };
    async function stream() {
      if (streaming || settled) return;
      streaming = true; run.setupMs = now();
      const start = now(), chunkBytes = BYTES_PER_SECOND / 50;
      for (let offset = 0; offset < pcm.length; offset += chunkBytes) {
        await delay(Math.max(0, start + offset / BYTES_PER_SECOND * 1000 - now()));
        if (settled) return;
        send({type: 'session.input_audio_buffer.append', audio: pcm.subarray(offset, offset + chunkBytes).toString('base64')});
      }
      await delay(Math.max(0, start + durationMs - now()));
      if (settled) return;
      run.stopMs = now();
      // Flush the utterance and receive ALL remaining audio before closing.
      send({type: 'session.close'});
    }
    ws.on('open', () => {
      if (provider === 'openai') {
        send({type: 'session.update', session: {audio: {input: {noise_reduction: null}, output: {language: target}}}});
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
        if (event.error || event.type === 'error') {
          const code = typeof event.error === 'string' ? event.error : event.error?.code || 'provider_error';
          throw new Error(`${provider}: ${code}`);
        }
        if (provider === 'openai') {
          if (event.type === 'session.updated') void stream().catch(finish);
          if (event.type === 'session.output_audio.delta') appendPacket(event.delta);
          if (event.type === 'session.output_transcript.delta') run.transcript += event.delta;
          if (event.type === 'session.closed') {
            if (run.stopMs === null) throw new Error('Translation session closed before the input finished.');
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
  const {values} = parseArgs({options: {audio: {type: 'string'}, synthetic: {type: 'boolean'}, source: {type: 'string'}, target: {type: 'string'}, run: {type: 'boolean'}, 'openai-first': {type: 'boolean'}}});
  if (Boolean(values.audio) === Boolean(values.synthetic) || !values.source || !values.target) throw new Error('Usage: node scripts/voice-benchmark/run.mjs (--audio input.wav | --synthetic) --source ko --target ja [--run]');
  if (!LANGUAGES.has(values.source) || !LANGUAGES.has(values.target) || (values.source !== 'ko' && values.target !== 'ko') || values.source === values.target) throw new Error('Compare Korean to/from a supported target language.');
  if (values.synthetic && (!Object.hasOwn(SYNTHETIC_CASES, values.source) || !Object.hasOwn(SYNTHETIC_CASES, values.target))) throw new Error('Synthetic comparison supports Korean and Japanese only.');
  const key = process.env.OPENAI_API_KEY;
  let wav = values.audio ? await fs.readFile(values.audio) : null;
  if (!values.run) {
    console.log(JSON.stringify({status: 'preflight_only', durationMs: wav ? readWav(wav).durationMs : null, inputKind: values.synthetic ? 'synthetic' : 'provided_audio', sampleText: values.synthetic ? SYNTHETIC_CASES[values.source].text : undefined, openaiKeyAvailable: Boolean(key), willCallPaidApis: false}));
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
    sourceSha256: createHash('sha256').update(wav).digest('hex'), sourceDurationMs: durationMs, inputSource,
    baselineModels: ['gemini-3.6-flash', 'gemini-3.1-flash-tts-preview'], candidateModel: 'gpt-realtime-translate',
    method: 'Ready connections. Gemini receives full WAV after stop; OpenAI receives identical PCM in real time while playback is held until stop. No prior conversation context. Latency is measured from this machine, not a phone.',
    limits: 'Queue metrics simulate app scheduling; they do not prove gapless audible speech. Listen to output WAVs and test a real phone before switching. Hindsight buffering is an offline lower bound. No quality score is assigned automatically.',
    runs: {}};
  for (const provider of values['openai-first'] ? ['openai', 'baseline'] : ['baseline', 'openai']) {
    try {
      const result = await collect({provider, wav, source: values.source, target: values.target, key});
      report.runs[provider] = summarize(result);
      await fs.writeFile(path.join(out, `${provider}.wav`), toWav(Buffer.concat(result.packets.map(p => p.pcm))), {mode: 0o600});
    } catch (error) {
      report.runs[provider] = {status: 'failed', error: String(error.message).split(key).join('[redacted]')};
      process.exitCode = 1;
    }
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2), {mode: 0o600});
    console.log(`${provider}: ${report.runs[provider].status}`);
  }
  console.log(`Private benchmark results: ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
