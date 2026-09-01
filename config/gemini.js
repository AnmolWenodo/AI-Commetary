import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

let aiInstance = null;

export const getGeminiClient = () => {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured in environment variables.");
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
};

// Lazy proxy for backward compatibility
const ai = new Proxy({}, {
  get(target, prop) {
    return getGeminiClient()[prop];
  }
});

export default ai;

