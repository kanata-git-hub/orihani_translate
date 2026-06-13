import express from "express";
import cors from "cors";
import path from "path";
import http from "http";
import dotenv from "dotenv";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

    clientWs.on("message", async (data) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch(e) {
        return;
      }

      if (msg.type === "start") {
        if (session) {
          session = null;
        }
        
        const targetLang = msg.targetLanguageCode || "ko";
        
        try {
          session = await ai.live.connect({
            model: "gemini-3.5-live-translate-preview",
            config: {
              responseModalities: [Modality.AUDIO],
              translationConfig: {
                targetLanguageCode: targetLang,
                echoTargetLanguage: true
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
            callbacks: {
              onmessage: (message: LiveServerMessage) => {
                const outMsg: any = {};
                
                if (message.serverContent?.modelTurn) {
                  const audio = message.serverContent.modelTurn.parts[0]?.inlineData?.data;
                  if (audio) {
                    outMsg.audio = audio;
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
                
                if (Object.keys(outMsg).length > 0) {
                  clientWs.send(JSON.stringify(outMsg));
                }
              },
            },
          });
          sessions.set(clientWs, session);
        } catch (e: any) {
          console.error("Live API Error:", e);
          clientWs.send(JSON.stringify({ error: e.message }));
        }
      } else if (msg.type === "audio" && msg.audio) {
        if (session) {
          try {
            session.sendRealtimeInput({
              audio: { data: msg.audio, mimeType: "audio/pcm;rate=16000" },
            });
          } catch(e) {
             console.error("Failed to send audio", e);
          }
        }
      } else if (msg.type === "stop") {
        if (session) {
            session = null;
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
      const interaction = await fetchWithBackoff(() => ai.interactions.create({
        model: 'gemini-3.1-flash-tts-preview',
        input: text,
        response_modalities: ['audio']
      }));
      for (const step of interaction.steps) {
        if (step.type === 'model_output') {
          const audioContent = step.content?.find(c => c.type === 'audio');
          if (audioContent && audioContent.data) {
            return res.json({ audio: audioContent.data });
          }
        }
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
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
