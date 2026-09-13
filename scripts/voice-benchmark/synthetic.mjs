import {readWav, toWav} from './core.mjs';
import {safeNetworkError} from './network.mjs';

export const SYNTHETIC_CASES = Object.freeze({
  ko: {voice: 'marin', text: '예약을 취소하지 말고 내일 오후 여섯 시 반으로 바꿔 주세요. 두 명이고, 한 명은 새우를 못 먹습니다. 추가 요금이 있다면 변경하기 전에 알려 주세요.'},
  ja: {voice: 'cedar', text: '予約はキャンセルせず、明日の午後六時半に変更してください。二人で、そのうち一人はエビを食べられません。追加料金がかかる場合は、変更する前に教えてください。'},
});

// Input fixture generation only. This does not replace the app's production TTS.
export async function generateSyntheticInput({source, key, fetchImpl = fetch}) {
  if (!Object.hasOwn(SYNTHETIC_CASES, source)) throw new Error('Synthetic input supports ko or ja only.');
  if (!key) throw new Error('OPENAI_API_KEY is not connected.');
  if (/[^\x21-\x7e]/.test(key)) throw new Error('API 키에 공백 또는 지원하지 않는 문자가 들어 있습니다. 키만 다시 복사하세요. 요청은 보내지 않았습니다.');
  const sample = SYNTHETIC_CASES[source];
  const model = 'gpt-4o-mini-tts';
  const instructions = `Read the provided ${source === 'ko' ? 'Korean' : 'Japanese'} text exactly, at a normal conversational pace. Use natural pauses. Do not translate, add commentary, or omit words.`;
  let response;
  try {
    response = await fetchImpl('https://api.openai.com/v1/audio/speech', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({model, voice: sample.voice, input: sample.text, instructions, response_format: 'pcm'}),
    });
  } catch (error) {
    throw new Error(`시험 음성 연결 실패 [${safeNetworkError(error)}]. 자동 재시도하지 않았습니다. 먼저 node scripts/voice-benchmark/diagnose.mjs 로 키 없는 연결 검사를 실행하세요.`);
  }
  // Never log raw provider responses, request headers or credentials.
  if (!response.ok) throw new Error(`Synthetic speech request failed (HTTP ${response.status}).`);
  let pcm;
  try { pcm = Buffer.from(await response.arrayBuffer()); }
  catch (error) { throw new Error(`시험 음성 수신 중단 [${safeNetworkError(error)}]. 자동 재시도하지 않았습니다.`); }
  const wav = toWav(pcm);
  readWav(wav); // Reject empty, incomplete or over-30-second output, never silently truncate it.
  return {wav, provenance: {kind: 'synthetic', provider: 'OpenAI', model, ...sample, instructions,
    limits: 'AI-generated input. Listen to source.wav to verify the spoken text. Clean synthesized speech and a same-provider input voice may bias results. This is a connection and initial latency check, not a real-world quality verdict. Fixture generation time is excluded from translation latency.'}};
}
