import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";

dotenv.config();

let anthropic = null;

export const getClaudeClient = () => {
  if (!anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY (or CLAUDE_API_KEY) is not configured in environment variables.");
    }
    anthropic = new Anthropic({ apiKey });
  }
  return anthropic;
};

export default getClaudeClient;
