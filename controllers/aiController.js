import { generateResponse, generateSingleComponentInsight, normalizeDataPayload } from "../services/aiService.js";
import { resolveProvider } from "../config/aiProviders.js";

/**
 * Extracts AI provider flag/name from query, headers, or body
 * Supported flag values:
 * 1 -> Gemini
 * 2 -> OpenAI
 * 3 -> Claude
 * Or strings: 'gemini', 'openai', 'claude'
 */
const extractProvider = (req) => {
  const flagFromQuery = req.query?.flag || req.query?.provider || req.query?.ai_provider || req.query?.aiModule;
  const flagFromHeaders = req.headers?.["x-ai-provider"] || req.headers?.["ai-provider"] || req.headers?.provider || req.headers?.flag;
  const flagFromBody = typeof req.body === "object" && !Array.isArray(req.body)
    ? (req.body?.flag || req.body?.provider || req.body?.ai_provider || req.body?.aiModule)
    : undefined;

  const rawFlag = flagFromQuery ?? flagFromHeaders ?? flagFromBody;
  return resolveProvider(rawFlag);
};

export const chat = async (req, res) => {
  try {
    const provider = extractProvider(req);
    let prompt = req.query?.prompt || req.headers?.prompt;
    let data;

    if (Array.isArray(req.body)) {
      data = req.body;
    } else if (req.body && typeof req.body === "object") {
      if (req.body.data !== undefined || req.body.prompt !== undefined) {
        prompt = req.body.prompt || prompt;
        data = req.body.data;
      } else {
        // Exclude control fields from data if data is the body object itself
        const { flag, provider: p, ai_provider, aiModule, prompt: bodyPrompt, ...rest } = req.body;
        if (bodyPrompt) prompt = bodyPrompt;
        data = Object.keys(rest).length > 0 ? rest : undefined;
      }
    }

    data = normalizeDataPayload(data);

    if (!prompt && (!data || (typeof data === "object" && Object.keys(data).length === 0))) {
      return res.status(400).json({
        success: false,
        message: "Prompt or JSON data payload is required",
      });
    }

    console.log(`[AI Chat] Provider: ${provider.toUpperCase()}`);
    console.log("Extracted Prompt ==>", prompt || "(Using default prompt instruction)");
    console.log("Extracted Data Components Count ==>", Array.isArray(data) ? data.length : 1);

    const response = await generateResponse({ prompt, data, provider });

    res.json({
      success: true,
      provider: response.provider,
      model: response.model,
      data: response.result,
      token_usage: response.usageMetadata,
    });
  } catch (error) {
    console.error("AI Controller Error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Controller to handle component insight request
 * Strictly returns the standardized Executive AI Commentary response structure
 */
export const getComponentInsight = async (req, res) => {
  try {
    const provider = extractProvider(req);
    let componentData = req.body;

    const customPrompt = req.query?.prompt || req.headers?.prompt || (typeof req.body === "object" && !Array.isArray(req.body) ? req.body?.prompt : undefined);

    if (componentData && typeof componentData === "object" && !Array.isArray(componentData)) {
      if (componentData.data !== undefined) {
        componentData = componentData.data;
      }
    }

    componentData = normalizeDataPayload(componentData);

    if (!componentData || (typeof componentData === "object" && Object.keys(componentData).length === 0)) {
      return res.status(400).json({
        success: false,
        message: "Component data object or array payload is required in request body",
      });
    }

    console.log(`[Component Insight] Provider: ${provider.toUpperCase()} | Data items count:`, Array.isArray(componentData) ? componentData.length : 1);

    const response = await generateResponse({
      prompt: customPrompt,
      data: componentData,
      provider,
    });

    res.json({
      success: true,
      provider: response.provider,
      model: response.model,
      data: response.result,
      token_usage: response.usageMetadata,
    });
  } catch (error) {
    console.error("Single Component Controller Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
