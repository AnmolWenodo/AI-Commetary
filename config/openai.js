import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

let openai = null;

export const getOpenAIClient = () => {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured in environment variables.");
    }
    openai = new OpenAI({ apiKey });
  }
  return openai;
};

export default getOpenAIClient;
