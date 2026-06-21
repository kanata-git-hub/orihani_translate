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

      if (msg.type === "process_text") {
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
          
          try {
            const ai = getAi();
            
            let responseStream;
          
            // Processing text directly
            let systemPrompt = `You are an expert conversational translator. Translate the given text to ${targetLang} in a casually polite tone. Output ONLY the raw translated text, with no markdown, intro, or labels.`;
            
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
            
            // immediately echo back the input transcription
            clientWs.send(JSON.stringify({
              role,
              inputTranscription: msg.text,
              partial: true
            }));

          let bufferStr = "";
          let finalTranscription = msg.text;
          let finalTranslation = "";

          let lastTranslLength = 0;
          let unprocessedTranslationBuffer = "";
          let ttsPromise = Promise.resolve();

          const queueTts = (textToSpeak: string) => {
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
            
            let currTrans = finalTranscription;
            let currTransl = bufferStr;
            
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
              partial: true
            }));
          }

          if (!finalTranslation.trim()) {
            clientWs.send(JSON.stringify({ error: "Could not translate audio", role, turnComplete: true }));
            return;
          }

          if (unprocessedTranslationBuffer.trim()) {
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
