import { registerChiikawa } from './chiikawa.ts';
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import dotenv from "dotenv";
import { WebSocketServer, WebSocket } from "ws";
import { createHash, timingSafeEqual } from "node:crypto";
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

let aiClient: GoogleGenAI | null = null;

// Temporary, expiring comparison; the normal app continues using its existing model.
// Only the local evaluator has the random token. Remove after recording the results.
const trialTokenHash = Buffer.from("af2052ed967bce3772c3e8077cc9f8af047ed06b59c7a3a075a5b874356d4ce5", "hex");
const trialExpiresAt = 1789065836807;
let trialRequests = 0;
function authorizeVoiceTrial(trial: any, audio: unknown): string | null {
  if (Date.now() >= trialExpiresAt || trialRequests >= 40 ||
      typeof trial?.token !== "string" || trial.token.length !== 64 ||
      typeof audio !== "string" || audio.length > 1000000 ||
      !["gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash"].includes(trial?.model)) return null;
  const hash = createHash("sha256").update(trial.token).digest();
  if (!timingSafeEqual(hash, trialTokenHash)) return null;
  trialRequests++;
  return trial.model;
}

function getAi(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      console.warn("GEMINI_API_KEY is missing! AI features will fail.");
    }
    aiClient = new GoogleGenAI({ apiKey: key || "dummy_key_to_prevent_crash" });
  }
  return aiClient;
}

// Exponential backoff helper
async function fetchWithBackoff(fn: () => Promise<any>, retries = 3, delayMs = 1000, timeoutMs = 45000) {
  for (let i = 0; i < retries; i++) {
    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("API Timeout")), timeoutMs);
      });
      return await Promise.race([fn(), timeoutPromise]);
    } catch (e: any) {
      const isRateLimitOrOverload = e?.status === 429 || e?.status === 503 || e?.message?.includes("429") || e?.message?.includes("503") || e?.message?.includes("Timeout");
      if (i === retries - 1 || !isRateLimitOrOverload) throw e;
      console.warn(`API Error [${e.status || e.message}], retrying in ${delayMs}ms (attempt ${i + 1}/${retries})...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }
} // <--- Added exponential backoff

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/live" });

  // Map to hold live sessions
  const sessions = new Map<WebSocket, any>();

  wss.on("connection", (clientWs, req) => {
    let session: any = null;

    let isClosing = false;
    
    clientWs.on("message", async (data) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch(e) {
        return;
      }

      const state = sessions.get(clientWs) || { processPromise: Promise.resolve() };
      sessions.set(clientWs, state);

      if (msg.type === "process_audio") {
        const trialModel = msg.modelTrial ? authorizeVoiceTrial(msg.modelTrial, msg.audio) : null;
        if (msg.modelTrial && !trialModel) {
          clientWs.send(JSON.stringify({ error: "MODEL_TRIAL_DENIED", role: msg.role, turnComplete: true }));
          return;
        }
        state.processPromise = state.processPromise.then(async () => {
          if (state?.session) {
            state.session = null;
          }
          
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
          const ttsEnabled = msg.ttsEnabled !== false;

          const foreignerLangCode = msg.foreignerLang || "en";
          const foreignerLangName = codeMap[foreignerLangCode.toLowerCase()] || "English";
          const sourceLang = role === "user" ? "Korean" : foreignerLangName;

          try {
            const ai = getAi();
            
            let systemPrompt = `You are an expert conversational translator that analyzes input audio directly. 
The speaker is speaking in ${sourceLang}.
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

            const trialMetrics: any = trialModel ? {
              requestedModel: trialModel, thinkingLevel: "medium", ttsModel: "gemini-3.1-flash-tts-preview"
            } : null;
            const translationStarted = performance.now();
            const responseStream = await fetchWithBackoff(() => ai.models.generateContentStream({
              model: trialModel || "gemini-3.6-flash",
              config: {
                systemInstruction: systemPrompt,
                responseMimeType: "application/json",
                ...(trialModel ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM } } : {})
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
            }));

            let bufferStr = "";
            let lastTranslLength = 0;
            let unprocessedTranslationBuffer = "";
            let ttsPromise = Promise.resolve();

            const queueTts = (textToSpeak: string) => {
              if (!ttsEnabled) return;
              ttsPromise = ttsPromise.then(async () => {
                try {
                  const ttsStream = await fetchWithBackoff(() => ai.models.generateContentStream({
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
                  }));
                  for await (const chunk of ttsStream) {
                    const base64Audio = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
                    if (base64Audio) {
                      clientWs.send(JSON.stringify({ role, audio: base64Audio }));
                    }
                  }
                } catch (e: any) {
                  console.error("TTS Gen Error:", e);
                }
              });
            };

            let detectedNoSpeech = false;

            for await (const chunk of responseStream) {
              if (trialMetrics) {
                trialMetrics.firstChunkMs ??= performance.now() - translationStarted;
                if (chunk.modelVersion) trialMetrics.modelVersion = chunk.modelVersion;
                if (chunk.usageMetadata) trialMetrics.usage = chunk.usageMetadata;
              }
              bufferStr += chunk.text;
              
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

              clientWs.send(JSON.stringify({
                role,
                inputTranscription: currTrans.trim(),
                outputTranscription: currTransl.trim(),
                outputPronunciation: currPronunciation.trim(),
                partial: true
              }));
            }

            if (trialMetrics) trialMetrics.translationCompleteMs = performance.now() - translationStarted;

            if (detectedNoSpeech) {
              clientWs.send(JSON.stringify({
                error: "NO_SPEECH_DETECTED",
                role,
                turnComplete: true
              }));
              return;
            }

            if (unprocessedTranslationBuffer.trim() && ttsEnabled) {
              queueTts(unprocessedTranslationBuffer.trim());
            }

            await ttsPromise;
            
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

            clientWs.send(JSON.stringify({
              role,
              inputTranscription: finalTrans.trim(),
              outputTranscription: finalTransl.trim(),
              outputPronunciation: finalPronun.trim(),
              ...(trialMetrics ? { metrics: trialMetrics } : {}),
              turnComplete: true
            }));

          } catch (e: any) {
            console.error("Audio pipeline Error:", e);
            clientWs.send(JSON.stringify({ error: e.message, role, turnComplete: true }));
          }
        }).catch(e => console.error("Process Audio Promise Error", e));
      } else if (msg.type === "process_text") {
        state.processPromise = state.processPromise.then(async () => {
          if (state?.session) {
            state.session = null;
          }
          
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
          const ttsEnabled = msg.ttsEnabled !== false;
          
          const foreignerLangCode = msg.foreignerLang || "en";
          const foreignerLangName = codeMap[foreignerLangCode.toLowerCase()] || "English";
          const sourceLang = role === "user" ? "Korean" : foreignerLangName;

          try {
            const ai = getAi();
            
            // immediately echo back the input transcription
            clientWs.send(JSON.stringify({
              role,
              inputTranscription: msg.text,
              partial: true
            }));

            let responseStream;
          
            // Processing text directly
            let systemPrompt = `You are an expert conversational translator. 
The input text is written in ${sourceLang}.
Translate the given text from ${sourceLang} to ${targetLang} in a casually polite tone. 

CRITICAL TRANSLATION RULES:
1. You MUST translate the text into the target language (${targetLang}).
2. The translation MUST sound completely natural to a native speaker of the target language (e.g., Japanese for Japanese, Korean for Korean, American for English, etc.). Ensure the tone, phrasing, grammar, and vocabulary are localized and authentic. You MUST completely rewrite the sentence to fit the natural grammar and expressions of the target language, avoiding literal or word-for-word translations.
3. If the target language is Korean, you MUST translate like a professional human translator (전문 번역가). Completely eliminate unnatural "translationese" (번역투) and excessive passive voice (피동 표현). Instead of literal structures like "~한다고 알려져 있다", "~의 증가가 확인되었다", or "~하다고 여겨진다", you MUST proactively rephrase sentences into active, natural Korean structures (e.g., "~라고 합니다", "증가했습니다", "~라고 생각합니다"). Adjust particles (조사, e.g., 은/는/이/가/을/를), word order, and verbs to flow perfectly and idiomatically as if originally written in Korean. Do not just replace words; restructure the entire sentence if necessary to ensure the highest translation quality.
4. You MUST write the translation using the NATIVE writing system of the target language (${targetLang}).
   - If the target language is Japanese, you MUST write the translation in Japanese characters (Kanji, Hiragana, Katakana) like "라도, 이거 냉정하게 생각하면" -> "でも、これ冷静に考えると".
   - If the target language is English or Spanish, you MUST write the translation in the Latin alphabet like "But, thinking about this calmly".
   - If the target language is Chinese, you MUST write the translation in Chinese characters (Hanzi) like "但是，冷静地想一想".
   - If the target language is Korean, you MUST write the translation in Korean Hangul like "하지만, 이걸 냉정하게 생각하면".
4. ABSOLUTELY FORBIDDEN: Do NOT write the target language translation using Korean Hangul pronunciation (e.g., do NOT write "데모, 코레..." in the Japanese translation slot). Hangul pronunciation is ONLY allowed in the [Pronunciation Guide] slot.
5. Do NOT output the original ${sourceLang} text in the Translation slot. The original text and the translation MUST be in their respective languages and must be completely distinct (unless they are exact names or loanwords).
6. If the input is already in the target language ${targetLang}, then transcription and translation can be identical, but if the input is in ${sourceLang}, the translation slot MUST be in ${targetLang}.

CRITICAL OUTPUT FORMAT REQUIREMENTS:
Output a valid JSON object and nothing else.
Format:
{
  "translation": "[Translated text]",
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

            responseStream = await fetchWithBackoff(() => ai.models.generateContentStream({
              model: "gemini-3.6-flash",
              config: {
                systemInstruction: systemPrompt,
                responseMimeType: "application/json"
              },
              contents: [
                {
                  role: "user",
                  parts: [{ text: msg.text }]
                }
              ]
            }));

          let bufferStr = "";
          let finalTranscription = msg.text;
          let finalTranslation = "";

          let lastTranslLength = 0;
          let unprocessedTranslationBuffer = "";
          let ttsPromise = Promise.resolve();

          const queueTts = (textToSpeak: string) => {
            if (!ttsEnabled) return;
            ttsPromise = ttsPromise.then(async () => {
              try {
                const ttsStream = await fetchWithBackoff(() => ai.models.generateContentStream({
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
                }));
                for await (const chunk of ttsStream) {
                  const base64Audio = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
                  if (base64Audio) {
                    clientWs.send(JSON.stringify({ role, audio: base64Audio }));
                  }
                }
              } catch (e: any) {
                console.error("TTS Gen Error:", e);
              }
            });
          };

          for await (const chunk of responseStream) {
            bufferStr += chunk.text;
            
            let currTransl = "";
            let currPronunciation = "";

            const translMatch = bufferStr.match(/"translation"\s*:\s*"((?:[^"\\]|\\.)*)/);
            if (translMatch) currTransl = translMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');

            const pronunMatch = bufferStr.match(/"pronunciation"\s*:\s*"((?:[^"\\]|\\.)*)/);
            if (pronunMatch) currPronunciation = pronunMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
            
            let currTrans = finalTranscription;
            
            finalTranscription = currTrans;
            finalTranslation = currTransl;

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

            clientWs.send(JSON.stringify({
              role,
              inputTranscription: currTrans.trim(),
              outputTranscription: currTransl.trim(),
              outputPronunciation: currPronunciation.trim(),
              partial: true
            }));
          }

          if (!finalTranslation.trim()) {
            clientWs.send(JSON.stringify({ error: "Could not translate audio", role, turnComplete: true }));
            return;
          }

          if (unprocessedTranslationBuffer.trim() && ttsEnabled) {
            queueTts(unprocessedTranslationBuffer.trim());
          }

          await ttsPromise;
          clientWs.send(JSON.stringify({ role, turnComplete: true }));
          
          // Asynchronously fix typos in the Korean transcription
          if (finalTranscription && msg.role === 'user') { // Assuming 'user' is the one speaking Korean
             const fixTyposAsync = async () => {
               try {
                 const ai = getAi();
                 const fixPrompt = `다음 한국어 문장은 음성 인식된 결과입니다. 문맥을 고려하여 명백한 오타나 인식 오류를 자연스럽게 수정해주세요.\n조건:\n- 어떠한 부가 설명이나 인사말 없이 오직 수정된 텍스트만 출력하세요.\n- 수정할 부분이 없으면 원래 텍스트를 그대로 출력하세요.\n\n텍스트: ${finalTranscription}`;
                 const res = await ai.models.generateContent({
                   model: "gemini-3.6-flash",
                   contents: [{ role: "user", parts: [{ text: fixPrompt }] }]
                 });
                 const corrected = res.text?.trim();
                 if (corrected && corrected !== finalTranscription) {
                   clientWs.send(JSON.stringify({ role, originalTranscription: finalTranscription, correctedTranscription: corrected }));
                 }
               } catch (e) {
                 console.error("Typo correction error:", e);
               }
             };
             fixTyposAsync();
          }

        } catch (e: any) {
          console.error("Pipeline Error:", e);
          clientWs.send(JSON.stringify({ error: e.message, role, turnComplete: true }));
        }
      }).catch(e => console.error("Process Promise Error", e));
    }
    });

    clientWs.on("close", () => {
      sessions.delete(clientWs);
    });
  });

  registerChiikawa(app);
  app.use(cors());
  app.use(express.json({ limit: "50mb" }));

  // API Health route
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/translate-image", async (req, res) => {
    try {
      const { imageParams, targetLang } = req.body; 
      const ai = getAi();
      
      const systemPrompt = `You are an OCR and translation expert. Analyze the image and perform two tasks:

TASK 1: EXHAUSTIVE OCR & TRANSLATION (CRITICAL)
- Group ALL text found in the image into logical paragraph blocks (do NOT split by individual words or single lines unless they stand alone).
- You MUST extract and translate EVERY single piece of text visible in the image to ${targetLang}. Do not skip any text, no matter how small or dense.
- The translation MUST sound completely natural to a native speaker of the target language (${targetLang}) (e.g., Japanese for Japanese, Korean for Korean, American for English, etc.). Ensure the tone, phrasing, grammar, and vocabulary are localized and authentic. You MUST completely rewrite the sentence to fit the natural grammar and expressions of the target language, avoiding literal or word-for-word translations.
- If the target language is Korean, you MUST translate like a professional human translator (전문 번역가). Completely eliminate unnatural "translationese" (번역투) and excessive passive voice (피동 표현). Instead of literal structures like "~한다고 알려져 있다", "~의 증가가 확인되었다", or "~하다고 여겨진다", you MUST proactively rephrase sentences into active, natural Korean structures (e.g., "~라고 합니다", "증가했습니다", "~라고 생각합니다"). Adjust particles (조사, e.g., 은/는/이/가/을/를), word order, and verbs to flow perfectly and idiomatically as if originally written in Korean. Do not just replace words; restructure the entire sentence if necessary to ensure the highest translation quality.
- For each paragraph block, provide the \`[ymin, xmin, ymax, xmax]\` coordinates normalized from 0 to 1000 representing the bounding box encompassing the entire paragraph in the original image.
- The box MUST tightly enclose only the original text, never enlarge it to fit the translation. Never merge separate speech balloons, panels, captions or signs.
- For every block provide text_regions: tight rectangles for each original text line/column, in [ymin,xmin,ymax,xmax] coordinates. Include all original glyphs and a tiny background margin, but NEVER include a face, character, speech-balloon outline, panel border, or object outline. Use separate rectangles when artwork separates words. These regions erase the original ink, so precision matters more than combining regions.
- Also provide layout_polygon: 4 to 16 ordered [y,x] points tracing the usable interior of that SAME speech balloon or caption, inset from its outline. This is where translated text will be typeset; it may use empty space around the original text but MUST exclude the balloon tail, faces, characters, props, panel borders, and neighboring balloons. It must be a simple polygon without crossed edges. For labels on objects and sound effects without a balloon, closely trace their original text region instead of borrowing space from nearby artwork.
- The translated text must remain at its original location. Do not add reference numbers, footnotes, summaries or separate translation lists. Preserve meaning, emotional tone and punctuation; do not shorten by dropping content just to fit.
- IMPORTANT: Your output MUST be strictly valid JSON. Ensure all double quotes inside strings are escaped as \\\". Ensure all newlines inside strings are escaped as \\n. Do not include trailing commas.

TASK 2: CONTEXT ANALYSIS
- Classify the overall image into one of these categories:
   - "price" (Menu, Receipt, Price tag, Discount notice)
   - "location" (Signboard, Tourist sign, Station name, Map)
   - "product" (Product packaging, cosmetics, medicine, brand)
   - "long_text" (Museum explanation, manual, long notice)
   - "general_info" (Food, landmarks, objects, animals, or images with no text)
   - "none" (If it doesn't fit well)
   
Extract relevant data for any of the fields below that are applicable to the image (you are highly encouraged to extract multiple fields if they apply):
  - "amount": If a price, receipt, menu, or cost is visible, extract the main numeric amount (number).
  - "currency": Standard 3-letter currency code (e.g., "JPY", "USD", "KRW", "EUR") matching the amount.
  - "location_keyword": If and only if a specific physical location, landmark (e.g., "麻布台ヒルズ"), restaurant/store name, station name, or tourist attraction is clearly identified, extract the exact name/noun in its original native language (do not translate to English) optimized for Google Maps. Do not extract generic descriptors or general text. Leave null if no specific physical location is identified.
  - "search_keyword": If any specific brand, product, food/dish name, proper noun, or main subject is identified (other than a physical map location), extract the exact name in its original native language (do not translate to English) optimized for search engines. Leave null if there is no specific product or proper noun.
  - "summary": 
    - If "long_text": provide a structured 3-line summary in ${targetLang}.
    - If "general_info" (or if describing food, objects, animals, landmarks, or the scene): provide a short 1-2 sentence description or identification of the main subject in ${targetLang}.

Return a strict JSON object with this exact structure:
{
  "blocks": [
    { "original": "string", "translation": "string", "box": [number, number, number, number], "text_regions": [[number, number, number, number]], "layout_polygon": [[number, number]] }
  ],
  "category": "string",
  "extracted_data": {
    "amount": number | null,
    "currency": "string | null",
    "location_keyword": "string | null",
    "search_keyword": "string | null",
    "summary": "string | null"
  }
}`;

      const response = await fetchWithBackoff(() => ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: [{
          role: "user",
          parts: [
            { text: systemPrompt },
            { 
               inlineData: { mimeType: imageParams.mimeType, data: imageParams.data } 
            }
          ]
        }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              blocks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    original: { type: Type.STRING },
                    translation: { type: Type.STRING },
                    box: { type: Type.ARRAY, items: { type: Type.INTEGER } },
                    text_regions: { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.INTEGER } } },
                    layout_polygon: { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.INTEGER } } }
                  },
                  required: ["original", "translation", "box", "text_regions", "layout_polygon"]
                }
              },
              category: { type: Type.STRING },
              extracted_data: {
                type: Type.OBJECT,
                properties: {
                  amount: { type: Type.NUMBER, nullable: true },
                  currency: { type: Type.STRING, nullable: true },
                  location_keyword: { type: Type.STRING, nullable: true },
                  search_keyword: { type: Type.STRING, nullable: true },
                  summary: { type: Type.STRING, nullable: true }
                },
                required: ["amount", "currency", "location_keyword", "search_keyword", "summary"]
              }
            },
            required: ["blocks", "category", "extracted_data"]
          },
          maxOutputTokens: 16384
        }
      }));

      if (response?.text) {
          let text = response.text.trim();
          if (text.startsWith('```json')) {
            text = text.substring(7);
          } else if (text.startsWith('```')) {
            text = text.substring(3);
          }
          if (text.endsWith('```')) {
            text = text.substring(0, text.length - 3);
          }
          try {
            const parsed = JSON.parse(text);
            return res.json(parsed);
          } catch (parseError) {
            console.error("JSON Parse Error. Raw response was:", text);
            throw parseError;
          }
      }
      res.status(500).json({ error: "Failed to process image" });
    } catch(e: any) {
        console.error("Image Translate Error", e);
        res.status(500).json({ error: e?.message || "Unknown error" });
    }
  });

  app.post("/api/tts", async (req, res) => {
    try {
      const { text } = req.body;
      const ai = getAi();
      const response = await fetchWithBackoff(() => ai.models.generateContent({
        model: 'gemini-3.1-flash-tts-preview',
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      }));
      const base64Audio = response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        return res.json({ audio: base64Audio });
      }
      res.status(500).json({ error: "No audio generated" });
    } catch (e: any) {
      console.error("TTS Error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/smart-search", async (req, res) => {
    try {
      const { category, targetLanguage } = req.body;
      const ai = getAi();
      
      const systemPrompt = `You are a local travel expert. 
The user selected the category: "${category}". 
The destination language is: "${targetLanguage}".

Find the MOST natural, culturally appropriate, and optimal local keyword for this category that locals actually use when searching on Google Maps. 

For example:
- If target is Japanese and category is "현지인 선술집", use "大衆居酒屋" or "立ち飲み".
- If target is French and category is "로컬 대형 마트", use "Hypermarché".
- If target is English and category is "가성비 백반집", use "Greasy spoon" or "Diner".

Return a strict JSON object with this exact structure:
{
  "keyword": "The optimal local keyword in the destination language",
  "explanation": "A very short, 1-line explanation in Korean (e.g., '현지인들이 퇴근 후 들르는 가성비 술집입니다.')"
}`;

      const response = await fetchWithBackoff(() => ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: [{ role: "user", parts: [{ text: systemPrompt }] }],
        config: {
          responseMimeType: "application/json"
        }
      }));

      if (response?.text) {
          const parsed = JSON.parse(response.text);
          return res.json(parsed);
      }
      res.status(500).json({ error: "Failed to generate search keyword" });
    } catch(e: any) {
        console.error("Smart Search Error", e);
        res.status(500).json({ error: e?.message || "Unknown error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.use((req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
