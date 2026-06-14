import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import dotenv from "dotenv";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";
import type { LiveServerMessage } from "@google/genai";

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

      const state = sessions.get(clientWs) || { pcmBuffer: [], processPromise: Promise.resolve() };
      sessions.set(clientWs, state);

      if (msg.type === "audio_chunk" && msg.audio) {
        state.pcmBuffer.push(Buffer.from(msg.audio, 'base64'));
        return;
      }

      if (msg.type === "process_text" || msg.type === "process_audio") {
        state.processPromise = state.processPromise.then(async () => {
          if (state?.session) {
            state.session = null;
          }
          
          const targetLang = msg.targetLanguageCode || "ko";
          const role = msg.role;
          
          try {
            const ai = getAi();
            
            let responseStream;
          
          if (msg.type === "process_audio") {
            let pcmBuffer: Buffer;
            if (msg.audio) {
               pcmBuffer = Buffer.from(msg.audio, 'base64');
            } else if (state.pcmBuffer.length > 0) {
               pcmBuffer = Buffer.concat(state.pcmBuffer);
               state.pcmBuffer = []; // reset
            } else {
               return;
            }
            const wavHeader = Buffer.alloc(44);
            wavHeader.write("RIFF", 0);
            wavHeader.writeUInt32LE(36 + pcmBuffer.length, 4);
            wavHeader.write("WAVE", 8);
            wavHeader.write("fmt ", 12);
            wavHeader.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
            wavHeader.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
            wavHeader.writeUInt16LE(1, 22); // NumChannels
            wavHeader.writeUInt32LE(16000, 24); // SampleRate
            wavHeader.writeUInt32LE(16000 * 2, 28); // ByteRate
            wavHeader.writeUInt16LE(2, 32); // BlockAlign
            wavHeader.writeUInt16LE(16, 34); // BitsPerSample
            wavHeader.write("data", 36);
            wavHeader.writeUInt32LE(pcmBuffer.length, 40);

            const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);
            const wavBase64 = wavBuffer.toString('base64');

            responseStream = await fetchWithBackoff(() => ai.models.generateContentStream({
              model: "gemini-3.5-flash",
              contents: [
                {
                  role: "user",
                  parts: [
                    {
                      text: `You are an accurate translator. Listen to the audio. 
If the targetLanguageCode is "ko", translate the audio to casually polite Korean. 
If the targetLanguageCode is not "ko" (e.g., "en", "ja"), translate the audio to that language in a casually polite tone.
Target Language Code: ${targetLang}

Output your response strictly in the following format:
TRANSCRIPTION:
<the exact string of what was spoken in the audio>
TRANSLATION:
<the casually polite translated string>`
                    },
                    {
                      inlineData: {
                        mimeType: "audio/wav",
                        data: wavBase64
                      }
                    }
                  ]
                }
              ]
            }));
          } else {
            // Processing text directly
            responseStream = await fetchWithBackoff(() => ai.models.generateContentStream({
              model: "gemini-3.5-flash",
              config: {
                systemInstruction: `You are an accurate translator. Translate the given text to ${targetLang} in a casually polite tone. Output ONLY the raw translated text, with no markdown, intro, or labels.`
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
          }

          let bufferStr = "";
          let finalTranscription = msg.type === "process_text" ? msg.text : "";
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
            let currTransl = finalTranslation;

            if (msg.type === "process_audio") {
              const transcrMatch = bufferStr.match(/TRANSCRIPTION:\s*([\s\S]*?)(?=\nTRANSLATION:|$)/);
              const translMatch = bufferStr.match(/TRANSLATION:\s*([\s\S]*)$/);
              
              if (transcrMatch) currTrans = transcrMatch[1];
              if (translMatch) currTransl = translMatch[1];
            } else {
              currTransl = bufferStr;
            }
            
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
