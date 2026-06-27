import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import dotenv from "dotenv";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

let aiClient: GoogleGenAI | null = null;

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
async function fetchWithBackoff(fn: () => Promise<any>, retries = 3, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      const isRateLimitOrOverload = e?.status === 429 || e?.status === 503 || e?.message?.includes("429") || e?.message?.includes("503");
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
        state.processPromise = state.processPromise.then(async () => {
          if (state?.session) {
            state.session = null;
          }
          
          const codeMap: Record<string, string> = {
            "ko": "Korean",
            "en": "English",
            "ja": "Japanese",
            "es": "Spanish",
            "zh": "Chinese"
          };
          const rawTarget = msg.targetLanguageCode || "Korean";
          const targetLang = codeMap[rawTarget.toLowerCase()] || rawTarget;
          const role = msg.role;
          const ttsEnabled = msg.ttsEnabled !== false;

          try {
            const ai = getAi();
            
            let systemPrompt = `You are an expert conversational translator that analyzes input audio directly. 
Translate the spoken content in the audio to ${targetLang} in a casually polite tone.

CRITICAL PROCESSING RULES FOR NOISE AND SILENCE:
- First, carefully evaluate if there is any actual human speech in the audio.
- If there is ONLY noise, silence, wind sound, breath sound, or if the speech is extremely faint/muffled such that it cannot be formed into any coherent words or phrases, you MUST output EXACTLY: "NO_SPEECH_DETECTED||||||"
- Do NOT try to translate or transcribe meaningless noise, ambient sounds, throat clearing, or short fragments of accidental whispers.

OUTPUT FORMAT REQUIREMENTS:
Output exactly three parts separated by "|||".
Format:
[Original Speech Transcription]|||[Casual Polite Translation in ${targetLang}]|||[Pronunciation Guide]

Pronunciation Guide Rules:
1. If the target language is NOT Korean, write the pronunciation guide in Korean Hangul so a Korean speaker can read it aloud.
   - English / Spanish: Apply stress and liaison (연음). Bold the stressed syllables using markdown bold (**text**). Write exactly as it sounds connected. (e.g., "What are you doing?" -> **와**라유 **두**잉?)
   - Chinese: Add tonal arrows (→, ↗, ↘↗, ↘) after the Hangul to indicate pitch. (e.g., "你好 (Nǐ hǎo)" -> 니↘↗ 하오↘↗)
   - Japanese: Clearly mark long vowels with a dash (-) or tilde (~). (e.g., "ありがとう (Arigatou)" -> 아리가**토**-)
2. If the target language IS Korean, provide the pronunciation guide in the native alphabet of the original speaker's language (e.g., Romaji for Japanese speakers, Pinyin for Chinese speakers, Romanized for English).
   - If pronunciation is not needed at all, leave it empty after the second "|||".

Output purely this single-line format and nothing else.`;

            if (msg.opponentText || msg.previousText) {
               systemPrompt += `\n\n--- CONVERSATION CONTEXT ---`;
               if (msg.opponentText) systemPrompt += `\nThe other person recently said: "${msg.opponentText}"`;
               if (msg.previousText) systemPrompt += `\nThe speaker previously said: "${msg.previousText}"`;
               systemPrompt += `\n----------------------------\nEnsure the translation flows naturally as a realistic dialogue response based on this context.`;
            }

            const responseStream = await fetchWithBackoff(() => ai.models.generateContentStream({
              model: "gemini-3.5-flash",
              config: {
                systemInstruction: systemPrompt
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
              bufferStr += chunk.text;
              
              if (bufferStr.includes("NO_SPEECH_DETECTED")) {
                detectedNoSpeech = true;
                break;
              }

              const splitParts = bufferStr.split("|||");
              let currTrans = splitParts[0] || "";
              let currTransl = splitParts.length > 1 ? splitParts[1] : "";
              let currPronunciation = splitParts.length > 2 ? splitParts[2] : "";

              const newlyTranslated = currTransl.slice(lastTranslLength);
              lastTranslLength = currTransl.length;

              if (newlyTranslated) {
                unprocessedTranslationBuffer += newlyTranslated;
                const boundaryRegex = /([.?!。！？]+)(?:\s+|\n+)/;
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
            
            const splitFinal = bufferStr.split("|||");
            clientWs.send(JSON.stringify({
              role,
              inputTranscription: (splitFinal[0] || "").trim(),
              outputTranscription: (splitFinal.length > 1 ? splitFinal[1] : "").trim(),
              outputPronunciation: (splitFinal.length > 2 ? splitFinal[2] : "").trim(),
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
            "zh": "Chinese"
          };
          const rawTarget = msg.targetLanguageCode || "Korean";
          const targetLang = codeMap[rawTarget.toLowerCase()] || rawTarget;
          const role = msg.role;
          const ttsEnabled = msg.ttsEnabled !== false;
          
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
            let systemPrompt = `You are an expert conversational translator. Translate the given text to ${targetLang} in a casually polite tone. 

CRITICAL OUTPUT FORMAT REQUIREMENTS:
Output ONLY the translated text, followed immediately by "|||" and the pronunciation guide.
Example:
Hello|||**헬**로우

Pronunciation Guide Rules:
1. If the target language is NOT Korean, write the pronunciation guide in Korean Hangul so a Korean speaker can read it aloud.
   - English / Spanish: Apply stress and liaison (연음). Bold the stressed syllables using markdown bold (**text**). Write exactly as it sounds connected. (e.g., "What are you doing?" -> **와**라유 **두**잉?)
   - Chinese: Add tonal arrows (→, ↗, ↘↗, ↘) after the Hangul to indicate pitch. (e.g., "你好 (Nǐ hǎo)" -> 니↘↗ 하오↘↗)
   - Japanese: Clearly mark long vowels with a dash (-) or tilde (~). (e.g., "ありがとう (Arigatou)" -> 아리가**토**-)
2. If the target language IS Korean, provide the pronunciation guide in the native alphabet of the original speaker's language (e.g., Romaji for Japanese speakers, Pinyin for Chinese speakers, Romanized for English).
   - If pronunciation is not needed at all, leave it empty after "|||".

Output purely the translation and the pronunciation separated by "|||". Do NOT include any other text.`;
            
            if (msg.opponentText || msg.previousText) {
               systemPrompt += `\n\n--- CONVERSATION CONTEXT ---`;
               if (msg.opponentText) systemPrompt += `\nThe other person recently said: "${msg.opponentText}"`;
               if (msg.previousText) systemPrompt += `\nThe speaker previously said: "${msg.previousText}"`;
               systemPrompt += `\n----------------------------\nEnsure the translation flows naturally as a realistic dialogue response based on this context.`;
            }

            responseStream = await fetchWithBackoff(() => ai.models.generateContentStream({
              model: "gemini-3.5-flash",
              config: {
                systemInstruction: systemPrompt
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
            
            const splitParts = bufferStr.split("|||");
            let currTransl = splitParts[0];
            let currPronunciation = splitParts.length > 1 ? splitParts[1] : "";
            
            let currTrans = finalTranscription;
            
            finalTranscription = currTrans;
            finalTranslation = currTransl;

            const newlyTranslated = currTransl.slice(lastTranslLength);
            lastTranslLength = currTransl.length;
            
            if (newlyTranslated) {
              unprocessedTranslationBuffer += newlyTranslated;
              const boundaryRegex = /([.?!。！？]+)(?:\s+|\n+)/;
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
                   model: "gemini-3.5-flash",
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
- For each paragraph block, provide the \`[ymin, xmin, ymax, xmax]\` coordinates normalized from 0 to 1000 representing the bounding box encompassing the entire paragraph in the original image.

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
    { "original": "string", "translation": "string", "box": [number, number, number, number] }
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
        model: "gemini-3.5-flash",
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
          responseMimeType: "application/json"
        }
      }));

      if (response?.text) {
          const parsed = JSON.parse(response.text);
          // ensure the root is returned, not just blocks
          return res.json(parsed);
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
