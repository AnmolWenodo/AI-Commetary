/**
 * geminiServices.js
 * Retained for backward-compatibility; re-exports unified multi-provider AI service.
 */
export {
  sanitizeComponentData,
  parseJSONResponse,
  callAIProvider,
  generateSingleComponentInsight,
  generateResponse,
  normalizeDataPayload,
  normalizeAICommentaryResult,
} from "./aiService.js";

import aiService from "./aiService.js";
export default aiService;