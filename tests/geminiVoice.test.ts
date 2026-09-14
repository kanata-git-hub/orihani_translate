import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildGeminiVoicePrompt, processGeminiAudio } from '../geminiVoice.ts';

const input = { role: 'user', foreignerLang: 'ja', targetLanguageCode: 'ja', audio: 'AAA=', mimeType: 'audio/wav' };
const audioChunk = { candidates: [{ content: { parts: [{ inlineData: { data: '6APoAw==' } }] } }] };

test('normal voice keeps the pre-change prompt in both directions; only the candidate asks for translation first', () => {
  // Digests taken from the deployed bd7210c prompt before extraction.
  for (const [role, target, digest] of [
    ['user', 'ja', '1b8a2195f476e0421fb3121d195f19043bc20bb083b772747d9ce5d99485591f'],
    ['foreigner', 'ko', '379690da8c0592e4337c389696d0d32a8093aa980f0a55d368779f3269c04349'],
  ]) {
    const msg = { ...input, role, targetLanguageCode: target };
    const normal = buildGeminiVoicePrompt(msg);
    assert.equal(createHash('sha256').update(normal).digest('hex'), digest);
    const candidate = buildGeminiVoicePrompt(msg, 'translation_first');
    assert.ok(candidate.indexOf('"translation":') < candidate.indexOf('"transcription":'));
    assert.ok(candidate.indexOf('"status":') < candidate.indexOf('"translation":'));
  }
});

test('translation-first starts TTS before transcription arrives, preserves all text, and measures real pipeline stages', async () => {
  const requests: any[] = [], events: any[] = [];
  let clock = 0;
  const timing = await processGeminiAudio(input, {
    generate: async request => {
      requests.push(request);
      if (request.model.includes('tts')) return (async function* () { clock += 20; yield audioChunk; })();
      return (async function* () {
        clock = 100;
        yield { text: '{"status":"SUCCESS","translation":"この商品はまだ会計しないでください。' };
        // Let the queued TTS request begin before the next text chunk.
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(requests.length, 2);
        assert.equal(requests[1].contents[0].parts[0].text, 'この商品はまだ会計しないでください。');
        assert.ok(events.some(e => e.audio));
        clock = 200;
        yield { text: 'カードで払います。","transcription":"이 물건은 아직 계산하지 마세요. 카드로 낼게요.","pronunciation":"카-도로 하라이마스"}' };
      })();
    }, send: event => events.push(event),
  }, { outputOrder: 'translation_first', measure: true, now: () => clock, originMs: 0 });
  assert.equal(requests[0].model, 'gemini-3.6-flash');
  assert.equal(requests[0].contents[0].parts[0].inlineData.data, input.audio);
  assert.deepEqual(requests.slice(1).map(r => r.contents[0].parts[0].text), ['この商品はまだ会計しないでください。', 'カードで払います。']);
  assert.ok(requests.slice(1).every(r => r.model === 'gemini-3.1-flash-tts-preview' && r.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName === 'Kore'));
  assert.equal(events.at(-1).inputTranscription, '이 물건은 아직 계산하지 마세요. 카드로 낼게요.');
  assert.equal(events.at(-1).outputTranscription, 'この商品はまだ会計しないでください。カードで払います。');
  assert.equal(events.at(-1).turnComplete, true);
  assert.deepEqual(timing.observedFieldOrder, ['status', 'translation', 'transcription', 'pronunciation']);
  assert.equal(timing.marks.firstTranslation, 100);
  assert.equal(timing.marks.firstAudio, 120);
  assert.equal(timing.marks.firstTranscription, 200);
  assert.equal(timing.tts.length, 2);
  assert.ok(timing.tts.every(t => t.completedMs !== undefined));
});

test('normal order, Japanese-to-Korean voice, and a translation without punctuation still produce one complete utterance', async () => {
  const requests: any[] = [], events: any[] = [];
  await processGeminiAudio({ ...input, role: 'foreigner', targetLanguageCode: 'ko' }, {
    generate: async request => {
      requests.push(request);
      return (async function* () {
        if (request.model.includes('tts')) yield audioChunk;
        else {
          yield { text: '{"status":"SUCCESS","transcription":"予約はそのままで","translation":"예약은 ' };
          yield { text: '그대로 둘게요","pronunciation":""}' };
        }
      })();
    }, send: event => events.push(event),
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].contents[0].parts[0].text, '예약은 그대로 둘게요');
  assert.equal(requests[1].config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Puck');
  assert.equal(events.at(-1).outputTranscription, '예약은 그대로 둘게요');
});

test('silence does not trigger TTS and a failed TTS is not reported as a successful comparison', async () => {
  for (const silence of [true, false]) {
    const requests: any[] = [], events: any[] = [];
    const timing = await processGeminiAudio(input, {
      generate: async request => {
        requests.push(request);
        if (request.model.includes('tts')) throw Error('private provider detail');
        return (async function* () { yield { text: silence
          ? '{"status":"NO_SPEECH_DETECTED","translation":"","transcription":"","pronunciation":""}'
          : '{"status":"SUCCESS","translation":"こんにちは。","transcription":"안녕하세요","pronunciation":""}' }; })();
      }, send: e => events.push(e),
    }, { measure: true, outputOrder: 'translation_first' });
    assert.equal(requests.length, silence ? 1 : 2);
    assert.ok(events.some(e => e.error === (silence ? 'NO_SPEECH_DETECTED' : 'TTS_FAILED')));
    if (!silence) assert.equal(timing.failed, true);
    assert.ok(!JSON.stringify(events).includes('private provider detail'));
  }
});

test('cancel stops queued TTS requests and forwards AbortSignal to active generation', async () => {
  const controller = new AbortController(), requests: any[] = [], events: any[] = [];
  await processGeminiAudio(input, {
    generate: async request => {
      requests.push(request); assert.equal(request.config.abortSignal, controller.signal);
      return (async function* () {
        if (request.model.includes('tts')) { controller.abort(); yield audioChunk; }
        else yield { text: '{"status":"SUCCESS","translation":"一つ目。二つ目。","transcription":"첫째. 둘째.","pronunciation":""}' };
      })();
    }, send: e => events.push(e),
  }, { measure: true, signal: controller.signal });
  assert.equal(requests.length, 2); // No request for the second sentence after cancellation.
  assert.ok(!events.some(e => e.audio || e.turnComplete));
});
