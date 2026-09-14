import { createHash } from 'node:crypto';

export type VoiceOutputOrder = 'transcription_first' | 'translation_first';
export type VoiceThinkingLevel = 'LOW';
export const GEMINI_VOICE_REVISION = 'output-order-2026-09-14';
export const GEMINI_THINKING_REVISION = 'thinking-low-2026-09-14';
type ModelUsage = Partial<Record<'promptTokenCount' | 'candidatesTokenCount' | 'thoughtsTokenCount' | 'cachedContentTokenCount' | 'totalTokenCount', number>>;
type Message = Record<string, any>;
type Dependencies = {
  generate: (request: any) => Promise<AsyncIterable<any>>;
  send: (message: Message) => void;
};
export type VoiceTiming = {
  revision: string; outputOrder: VoiceOutputOrder; promptSha256: string;
  clock: string; marks: Record<string, number>; observedFieldOrder: string[];
  tts: { queuedMs: number; requestedMs?: number; firstAudioMs?: number; completedMs?: number; failed?: boolean }[];
  failed?: boolean;
  requestedThinkingLevel?: VoiceThinkingLevel | 'DEFAULT';
  modelVersion?: string; finishReason?: string; usage?: ModelUsage;
};

export function buildGeminiVoicePrompt(msg: Message, outputOrder: VoiceOutputOrder = 'transcription_first') {
  const codeMap: Record<string, string> = {
    "ko": "Korean",
    "en": "English",
    "ja": "Japanese",
    "es": "Spanish",
    "zh": "Chinese",
    "fr": "French",
    "de": "German",
    "it": "Italian",
    "nl": "Dutch"
  };
  const rawTarget = msg.targetLanguageCode || "Korean";
  const targetLang = codeMap[rawTarget.toLowerCase()] || rawTarget;
  const role = msg.role;

  const foreignerLangCode = msg.foreignerLang || "en";
  const foreignerLangName = codeMap[foreignerLangCode.toLowerCase()] || "English";
  const sourceLang = role === "user" ? "Korean" : foreignerLangName;

  let systemPrompt = "You are an expert conversational translator that analyzes input audio directly. \n" + `The speaker is speaking in ${sourceLang}.
Translate the spoken content in the audio from ${sourceLang} to ${targetLang} in a casually polite tone.

CRITICAL TRANSLATION RULES:
1. You MUST translate the text into the target language (${targetLang}).
2. The translation MUST sound completely natural to a native speaker of the target language (e.g., Japanese for Japanese, Korean for Korean, American for English, etc.). Ensure the tone, phrasing, grammar, and vocabulary are localized and authentic. You MUST completely rewrite the sentence to fit the natural grammar and expressions of the target language, avoiding literal or word-for-word translations.
3. If the target language is Korean, you MUST translate like a professional human translator (전문 번역가). Completely eliminate unnatural "translationese" (번역투) and excessive passive voice (피동 표현). Instead of literal structures like "~한다고 알려져 있다", "~의 증가가 확인되었다", or "~하다고 여겨진다", you MUST proactively rephrase sentences into active, natural Korean structures (e.g., "~라고 합니다", "증가했습니다", "~라고 생각합니다"). Adjust particles (조사, e.g., 은/는/이/가/을/를), word order, and verbs to flow perfectly and idiomatically as if originally written in Korean. Do not just replace words; restructure the entire sentence if necessary to ensure the highest translation quality.
4. You MUST write the translation using the NATIVE writing system of the target language (${targetLang}).
   - If the target language is Japanese, you MUST write the translation in Japanese characters (Kanji, Hiragana, Katakana) like "でも、これ冷静に考えると".
   - If the target language is English or Spanish, you MUST write the translation in the Latin alphabet like "But, thinking about this calmly".
   - If the target language is Chinese, you MUST write the translation in Chinese characters (Hanzi) like "但是，冷静地想一想".
   - If the target language is Korean, you MUST write the translation in Korean Hangul like "하지만, 이걸 냉정하게 생각하면".
4. ABSOLUTELY FORBIDDEN: Do NOT write the target language translation using Korean Hangul pronunciation (e.g., do NOT write "데모, 코레..." in the Japanese translation slot). Hangul pronunciation is ONLY allowed in the [Pronunciation Guide] slot.
5. Do NOT output the transcription of the original ${sourceLang} text in the Translation slot. The original transcription and the translation MUST be in their respective languages and must be completely distinct (unless they are exact names or loanwords).
6. If the audio is already in the target language ${targetLang}, then transcription and translation can be identical, but if the audio is in ${sourceLang}, the translation slot MUST be in ${targetLang}.

CRITICAL PROCESSING RULES FOR NOISE AND SILENCE:
- First, carefully evaluate if there is any actual human speech in the audio.
- If there is ONLY noise, silence, wind sound, breath sound, or if the speech is extremely faint/muffled such that it cannot be formed into any coherent words or phrases, you MUST set the "status" field to "NO_SPEECH_DETECTED".
- Do NOT try to translate or transcribe meaningless noise, ambient sounds, throat clearing, or short fragments of accidental whispers.

OUTPUT FORMAT REQUIREMENTS:
Output a valid JSON object and nothing else.
Format:
{
  "status": "SUCCESS" or "NO_SPEECH_DETECTED",
  "transcription": "[Original Speech Transcription in ${sourceLang}]",
  "translation": "[Casual Polite Translation in ${targetLang}]",
  "pronunciation": "[Pronunciation Guide]"
}

Pronunciation Guide Rules:
1. If the target language is NOT Korean, write the pronunciation guide in Korean Hangul so a Korean speaker can read it aloud.
   - English / Spanish: Apply stress and liaison (연음). Bold the stressed syllables using markdown bold (**text**). Write exactly as it sounds connected. (e.g., "What are you doing?" -> **와**라유 **두**잉?)
   - Chinese: Add tonal arrows (→, ↗, ↘↗, ↘) after the Hangul to indicate pitch. (e.g., "你好 (Nǐ hǎo)" -> 니↘↗ 하오↘↗)
   - Japanese: Clearly mark long vowels with a dash (-) or tilde (~). (e.g., "ありがとう (Arigatou)" -> 아리가**토**-)
2. If the target language IS Korean, provide the pronunciation guide in the native alphabet of the original speaker's language (e.g., Romaji for Japanese speakers, Pinyin for Chinese speakers, Romanized for English).
   - If pronunciation is not needed at all, leave it empty.
`;

    if (msg.opponentText || msg.previousText) {
       systemPrompt += `\n\n--- CONVERSATION CONTEXT ---`;
       if (msg.opponentText) systemPrompt += `\nThe other person recently said: "${msg.opponentText}"`;
       if (msg.previousText) systemPrompt += `\nThe speaker previously said: "${msg.previousText}"`;
       systemPrompt += `\n----------------------------\nEnsure the translation flows naturally as a realistic dialogue response based on this context.`;
    }
  if (outputOrder === 'translation_first') {
    const original = `  "transcription": "[Original Speech Transcription in ${sourceLang}]",
  "translation": "[Casual Polite Translation in ${targetLang}]",`;
    const reordered = `  "translation": "[Casual Polite Translation in ${targetLang}]",
  "transcription": "[Original Speech Transcription in ${sourceLang}]",`;
    systemPrompt = systemPrompt.replace(original, reordered);
    systemPrompt += '\nWrite the JSON keys in this order: status, translation, transcription, pronunciation.\n';
  }
  return systemPrompt;
}

export async function processGeminiAudio(msg: Message, deps: Dependencies, options: {
  outputOrder?: VoiceOutputOrder; signal?: AbortSignal; measure?: boolean;
  thinkingLevel?: VoiceThinkingLevel;
  originMs?: number; now?: () => number;
} = {}): Promise<VoiceTiming> {
  const now = options.now ?? (() => performance.now());
  const origin = options.originMs ?? now();
  const systemPrompt = buildGeminiVoicePrompt(msg, options.outputOrder);
  const timing: VoiceTiming = {
    revision: GEMINI_VOICE_REVISION, outputOrder: options.outputOrder ?? 'transcription_first',
    promptSha256: createHash('sha256').update(systemPrompt).digest('hex'),
    clock: 'Milliseconds since server received stop (comparison); same clock for both variants. Not browser/speaker latency.',
    marks: {}, observedFieldOrder: [], tts: [],
    ...(options.measure ? { requestedThinkingLevel: options.thinkingLevel ?? 'DEFAULT' } : {}),
  };
  const mark = (name: string) => { timing.marks[name] ??= now() - origin; };
  const send = (message: Message) => { if (!options.signal?.aborted) deps.send(message); };
  const active = () => !options.signal?.aborted;
  const generate = (request: any) => {
    options.signal?.throwIfAborted();
    if (options.signal) request.config = { ...request.config, abortSignal: options.signal };
    return deps.generate(request);
  };
  const role = msg.role, ttsEnabled = msg.ttsEnabled !== false;

  try {
    mark('modelRequested');
    const responseStream = await generate({
      model: "gemini-3.6-flash",
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        ...(options.thinkingLevel ? { thinkingConfig: { thinkingLevel: options.thinkingLevel } } : {}),
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: msg.mimeType || "audio/webm",
                data: msg.audio
              }
            }
          ]
        }
      ]
    });

    let bufferStr = "";
    let lastTranslLength = 0;
    let unprocessedTranslationBuffer = "";
    let ttsPromise = Promise.resolve();

    const queueTts = (textToSpeak: string) => {
      if (!ttsEnabled) return;
      mark('firstSentenceReady');
      const item: VoiceTiming['tts'][number] = { queuedMs: now() - origin }; timing.tts.push(item);
      ttsPromise = ttsPromise.then(async () => {
        if (!active()) return;
        item.requestedMs = now() - origin; mark('firstTtsRequested');
        try {
          const ttsStream = await generate({
            model: "gemini-3.1-flash-tts-preview",
            contents: [{ parts: [{ text: textToSpeak }] }],
            config: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: role === 'foreigner' ? "Puck" : "Kore" },
                },
              },
            },
          });
          for await (const chunk of ttsStream) {
            if (!active()) break;
            const base64Audio = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              item.firstAudioMs ??= now() - origin; mark('firstAudio');
              send({ role, audio: base64Audio });
            }
          }
          item.completedMs = now() - origin;
        } catch (e: any) {
          item.failed = true; timing.failed = true;
          if (options.measure && active()) send({ role, error: 'TTS_FAILED' });
        }
      });
    };

    let detectedNoSpeech = false;

    for await (const chunk of responseStream) {
      if (!active()) break;
      mark('firstModelChunk');
      if (options.measure) {
        // Whitelist numeric usage only; never export thoughts, signatures, headers or raw responses.
        if (typeof chunk.modelVersion === 'string') timing.modelVersion = chunk.modelVersion;
        const reason = chunk.candidates?.[0]?.finishReason;
        if (typeof reason === 'string') timing.finishReason = reason;
        for (const key of ['promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount', 'cachedContentTokenCount', 'totalTokenCount'] as const) {
          const value = chunk.usageMetadata?.[key];
          // Stream usage values are snapshots, not increments. Missing is not zero.
          if (Number.isSafeInteger(value) && value >= 0) (timing.usage ??= {})[key] = value;
        }
        if (chunk.text) mark('firstModelText');
      }
      bufferStr += chunk.text ?? "";

      if (bufferStr.includes('"NO_SPEECH_DETECTED"')) {
        detectedNoSpeech = true;
        break;
      }

      let currTrans = "";
      let currTransl = "";
      let currPronunciation = "";

      const transMatch = bufferStr.match(/"transcription"\s*:\s*"((?:[^"\\]|\\.)*)/);
      if (transMatch) currTrans = transMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');

      const translMatch = bufferStr.match(/"translation"\s*:\s*"((?:[^"\\]|\\.)*)/);
      if (translMatch) currTransl = translMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');

      const pronunMatch = bufferStr.match(/"pronunciation"\s*:\s*"((?:[^"\\]|\\.)*)/);
      if (pronunMatch) currPronunciation = pronunMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');

      if (currTrans) mark('firstTranscription');
      if (currTransl) mark('firstTranslation');
      if (/"translation"\s*:\s*"(?:[^"\\]|\\.)*"/.test(bufferStr)) mark('translationComplete');
      if (options.measure) timing.observedFieldOrder = [...bufferStr.matchAll(/"(status|transcription|translation|pronunciation)"\s*:/g)].map(m => m[1]);

      const newlyTranslated = currTransl.slice(lastTranslLength);
      lastTranslLength = currTransl.length;

      if (newlyTranslated) {
        unprocessedTranslationBuffer += newlyTranslated;
        const boundaryRegex = /([。！？]+|[.?!]+(?=\s))/;
        while (true) {
          const match = boundaryRegex.exec(unprocessedTranslationBuffer);
          if (match) {
            const splitIndex = match.index + match[1].length;
            const sentence = unprocessedTranslationBuffer.slice(0, splitIndex).trim();
            unprocessedTranslationBuffer = unprocessedTranslationBuffer.slice(splitIndex).trimStart();
            if (sentence) {
              queueTts(sentence);
            }
          } else {
            break;
          }
        }
      }

      if (/"translation"\s*:\s*"(?:[^"\\]|\\.)*"/.test(bufferStr) && unprocessedTranslationBuffer.trim()) {
        queueTts(unprocessedTranslationBuffer.trim());
        unprocessedTranslationBuffer = "";
      }

      send({
        role,
        inputTranscription: currTrans.trim(),
        outputTranscription: currTransl.trim(),
        outputPronunciation: currPronunciation.trim(),
        partial: true
      });
    }

    mark('modelComplete');
    if (!active()) { await ttsPromise; return timing; }
    if (detectedNoSpeech) {
      send({
        error: "NO_SPEECH_DETECTED",
        role,
        turnComplete: true
      });
      return timing;
    }

    if (unprocessedTranslationBuffer.trim() && ttsEnabled) {
      queueTts(unprocessedTranslationBuffer.trim());
    }

    await ttsPromise;
    mark('allAudioComplete');

    let finalTrans = "";
    let finalTransl = "";
    let finalPronun = "";
    try {
      const parsed = JSON.parse(bufferStr);
      finalTrans = parsed.transcription || "";
      finalTransl = parsed.translation || "";
      finalPronun = parsed.pronunciation || "";
    } catch(e) {
      const transMatch = bufferStr.match(/"transcription"\s*:\s*"((?:[^"\\]|\\.)*)/);
      if (transMatch) finalTrans = transMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
      const translMatch = bufferStr.match(/"translation"\s*:\s*"((?:[^"\\]|\\.)*)/);
      if (translMatch) finalTransl = translMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
      const pronunMatch = bufferStr.match(/"pronunciation"\s*:\s*"((?:[^"\\]|\\.)*)/);
      if (pronunMatch) finalPronun = pronunMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
    }

    send({
      role,
      inputTranscription: finalTrans.trim(),
      outputTranscription: finalTransl.trim(),
      outputPronunciation: finalPronun.trim(),
      turnComplete: true
    });

  } catch (e: any) {
    timing.failed = true;
    send({ error: e.message, role, turnComplete: true });
  }
  return timing;
}
