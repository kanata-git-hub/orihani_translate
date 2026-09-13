import {readWav, toWav} from './core.mjs';

export const SYNTHETIC_CASES = Object.freeze({
  ko: {voice: 'marin', text: '예약을 취소하지 말고 내일 오후 여섯 시 반으로 바꿔 주세요. 두 명이고, 한 명은 새우를 못 먹습니다. 추가 요금이 있다면 변경하기 전에 알려 주세요.'},
  ja: {voice: 'cedar', text: '予約はキャンセルせず、明日の午後六時半に変更してください。二人で、そのうち一人はエビを食べられません。追加料金がかかる場合は、変更する前に教えてください。'},
});

// Input fixture generation only. This does not replace the app's production TTS.
export async function generateSyntheticInput({source, key, fetchImpl = fetch}) {
  if (!Object.hasOwn(SYNTHETIC_CASES, source)) throw new Error('Synthetic input supports ko or ja only.');
  if (!key) throw new Error('OPENAI_API_KEY is not connected.');
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
  } catch {
    throw new Error('Synthetic speech connection failed or timed out. No automatic retry was made.');
  }
  // Never log raw provider responses, request headers or credentials.
  if (!response.ok) throw new Error(`Synthetic speech request failed (HTTP ${response.status}).`);
  let pcm;
  try { pcm = Buffer.from(await response.arrayBuffer()); }
  catch { throw new Error('Synthetic speech response was interrupted.'); }
  const wav = toWav(pcm);
  readWav(wav); // Reject empty, incomplete or over-30-second output, never silently truncate it.
  return {wav, provenance: {kind: 'synthetic', provider: 'OpenAI', model, ...sample, instructions,
    limits: 'AI-generated input. Listen to source.wav to verify the spoken text. Clean synthesized speech and a same-provider input voice may bias results. This is a connection and initial latency check, not a real-world quality verdict. Fixture generation time is excluded from translation latency.'}};
}
