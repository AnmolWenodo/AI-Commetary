/**
 * AI Provider Definitions and Helpers
 * 1 -> Gemini
 * 2 -> OpenAI
 * 3 -> Claude (Anthropic)
 */

export const AI_PROVIDERS = {
  GEMINI: "gemini",
  OPENAI: "openai",
  CLAUDE: "claude",
};

export const PROVIDER_MAP = {
  "1": AI_PROVIDERS.GEMINI,
  "gemini": AI_PROVIDERS.GEMINI,
  "google": AI_PROVIDERS.GEMINI,

  "2": AI_PROVIDERS.OPENAI,
  "openai": AI_PROVIDERS.OPENAI,
  "chatgpt": AI_PROVIDERS.OPENAI,
  "gpt": AI_PROVIDERS.OPENAI,

  "3": AI_PROVIDERS.CLAUDE,
  "claude": AI_PROVIDERS.CLAUDE,
  "anthropic": AI_PROVIDERS.CLAUDE,
};

/**
 * Resolves the AI provider name from any given flag, code, or name.
 * Supported values:
 * - 1, '1', 'gemini' -> 'gemini'
 * - 2, '2', 'openai' -> 'openai'
 * - 3, '3', 'claude', 'anthropic' -> 'claude'
 * Falls back to process.env.DEFAULT_AI_PROVIDER or 'openai'.
 *
 * @param {string|number} flagOrName
 * @returns {string} canonical provider name ('gemini', 'openai', 'claude')
 */
export const resolveProvider = (flagOrName) => {
  if (flagOrName !== undefined && flagOrName !== null) {
    const key = String(flagOrName).trim().toLowerCase();
    if (PROVIDER_MAP[key]) {
      return PROVIDER_MAP[key];
    }
  }

  // Fallback to default in environment or openai
  const envDefault = process.env.DEFAULT_AI_PROVIDER || "openai";
  const envKey = String(envDefault).trim().toLowerCase();
  return PROVIDER_MAP[envKey] || AI_PROVIDERS.OPENAI;
};

/**
 * Get active model name configured for the provider
 * @param {string} provider
 * @returns {string} model name
 */
export const getProviderModel = (provider) => {
  switch (provider) {
    case AI_PROVIDERS.GEMINI:
      return (process.env.GEMINI_MODEL || "gemini-2.0-flash").trim();
    case AI_PROVIDERS.CLAUDE:
      return (process.env.CLAUDE_MODEL || process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001").trim();
    case AI_PROVIDERS.OPENAI:
    default:
      return (process.env.OPENAI_MODEL || "gpt-4o").trim();
  }
};
