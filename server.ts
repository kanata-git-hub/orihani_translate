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

      const state = sessions.get(clientWs);

      if (msg.type === "process_audio" && msg.audio) {
        if (state?.session) {
          state.session = null;
        }
        
        const targetLang = msg.targetLanguageCode || "ko";
        const role = msg.role;
        
        sessions.set(clientWs, { session: null, queue: [], connected: false });
        
        try {
          const ai = getAi();
          const newSession = await ai.live.connect({
            model: "gemini-3.5-live-translate-preview",
            config: {
              responseModalities: [Modality.AUDIO],
              translationConfig: {
                targetLanguageCode: targetLang,
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
            callbacks: {
              onmessage: (message: LiveServerMessage) => {
                const outMsg: any = { role };
                
                if (message.serverContent?.modelTurn?.parts) {
                  const audioPart = message.serverContent.modelTurn.parts.find(p => p.inlineData && p.inlineData.data);
                  if (audioPart) {
                    outMsg.audio = audioPart.inlineData.data;
                  }
                }
                if (message.serverContent?.interrupted) {
                  outMsg.interrupted = true;
                }
                if (message.serverContent?.inputTranscription?.text) {
                  outMsg.inputTranscription = message.serverContent.inputTranscription.text;
                }
                if (message.serverContent?.outputTranscription?.text) {
                  outMsg.outputTranscription = message.serverContent.outputTranscription.text;
                }
                if (message.serverContent?.turnComplete) {
                  outMsg.turnComplete = true;
                }
                
                if (Object.keys(outMsg).length > 1) { // More than just 'role'
                  clientWs.send(JSON.stringify(outMsg));
                }
              },
            },
          });
          
          sessions.set(clientWs, { session: newSession, queue: [], connected: true });
          
          newSession.sendRealtimeInput({
            audio: {
              mimeType: "audio/pcm;rate=16000",
              data: msg.audio
            }
          });
          
          newSession.sendClientContent({
            turnComplete: true
          });
          
        } catch (e: any) {
          console.error("Live API Error:", e);
          clientWs.send(JSON.stringify({ error: e.message, role }));
        }
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
