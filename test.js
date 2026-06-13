import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: "dummy" });
ai.live.connect({ model: "gemini-3.5-live-translate-preview", callbacks: {} })
  .then(session => {
    console.log(session.sendRealtimeInput.toString());
    process.exit(0);
  })
  .catch(console.error);
