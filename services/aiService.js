import { getGeminiClient } from "../config/gemini.js";
import { getOpenAIClient } from "../config/openai.js";
import { getClaudeClient } from "../config/claude.js";
import { AI_PROVIDERS, resolveProvider, getProviderModel } from "../config/aiProviders.js";
import logger from "../config/logger.js";

const IGNORED_METADATA_KEYS = new Set([
  "OBJ_PI_INPUT_MODEL", "obj_pi_input_model",
  "COLORS", "colors",
  "SHOWXAXIS", "SHOWYAXIS", "SHOWY2AXIS", "STACKED", "LEGEND", "LW_UP", "LY_UP", "WEEKDAY_ID",
  "MIN", "MAX", "TICK_AMOUNT", "MAX_X", "MAX_Y", "NEGATIVE_MAX",
  "ACTUALFILEPATH", "FILE_PATH", "FILE_NAME", "RETURN_FILE_NAME", "FOLDER_NAME",
  "SP_NAME", "SP_PARAMETERS", "SP_EXECUTION_NAME", "SP_EXECUTION_PARAMETERS",
  "CURRENT_TOKEN", "TITLE_VALUE", "TYPE", "CW", "LW", "LY", "LEAVE_COST",
  "EXPORT_FLAG", "PROCESSING_FLAG", "EMAIL_SCHEDULE_ID"
]);

const ESSENTIAL_IDENTIFIERS = new Set([
  "COMPONENT_TYPE_ID", "COMPONENT_ID", "ID", "id", "Val1"
]);

/**
 * Universally sanitizes any component or arbitrary business data structure:
 * 1. Strips all `null`, `undefined`, empty strings `""`, whitespace-only strings, "null", "undefined", "n/a", "nan", "-", "--".
 * 2. Removes uninformative 0/0.00% metrics (while keeping essential ID fields).
 * 3. Recursively removes empty objects `{}` and empty arrays `[]`.
 * 4. Strips series/lists that contain only zeros, nulls, or empty values.
 * 5. Strips internal SQL execution configurations, file paths, and UI styling metadata.
 */
export const sanitizeComponentData = (data) => {
  if (data === null || data === undefined) return null;

  const isBlankValue = (val, key = "") => {
    if (val === null || val === undefined) return true;

    if (typeof val === "boolean") {
      return val === false;
    }

    if (typeof val === "string") {
      const trimmed = val.trim();
      if (trimmed === "") return true;
      const lower = trimmed.toLowerCase();
      if (
        lower === "null" ||
        lower === "undefined" ||
        lower === "n/a" ||
        lower === "nan" ||
        lower === "none" ||
        lower === "-" ||
        lower === "--"
      ) {
        return true;
      }
      if (!ESSENTIAL_IDENTIFIERS.has(key)) {
        if (
          lower === "0" ||
          lower === "0.0" ||
          lower === "0.00" ||
          lower === "0%" ||
          lower === "0.0%" ||
          lower === "0.00%"
        ) {
          return true;
        }
      }
      return false;
    }

    if (typeof val === "number") {
      if (isNaN(val)) return true;
      if (!ESSENTIAL_IDENTIFIERS.has(key) && val === 0) return true;
      return false;
    }

    return false;
  };

  const isEmptySeries = (arr) => {
    if (!Array.isArray(arr)) return false;
    if (arr.length === 0) return true;
    return arr.every((item) => {
      if (item === null || item === undefined) return true;
      if (typeof item === "string") return isBlankValue(item);
      if (typeof item === "number") return item === 0 || isNaN(item);
      if (Array.isArray(item)) return isEmptySeries(item);
      if (typeof item === "object") return Object.keys(item).length === 0;
      return false;
    });
  };

  const cleanObject = (obj, parentKey = "") => {
    if (obj === null || obj === undefined) return null;

    if (Array.isArray(obj)) {
      if (isEmptySeries(obj)) return null;

      const cleanedArr = obj
        .map((item) => cleanObject(item, parentKey))
        .filter((item) => {
          if (item === null || item === undefined) return false;
          if (typeof item === "string" && isBlankValue(item, parentKey)) return false;
          if (typeof item === "object") {
            if (Array.isArray(item)) return item.length > 0;
            return Object.keys(item).length > 0;
          }
          return true;
        });

      return cleanedArr.length > 0 ? cleanedArr : null;
    }

    if (typeof obj === "object") {
      const cleaned = {};
      for (const [key, value] of Object.entries(obj)) {
        if (IGNORED_METADATA_KEYS.has(key)) continue;

        // Skip duplicate root DISPLAY_DATA if BUBBLECHARTDATALIST exists
        if (key === "DISPLAY_DATA" && obj.BUBBLECHARTDATALIST) continue;

        if (isBlankValue(value, key)) continue;

        if (Array.isArray(value)) {
          if (isEmptySeries(value)) continue;
          const cleanedArr = cleanObject(value, key);
          if (cleanedArr !== null && cleanedArr.length > 0) {
            cleaned[key] = cleanedArr;
          }
          continue;
        }

        if (typeof value === "object" && value !== null) {
          const res = cleanObject(value, key);
          if (res !== null && Object.keys(res).length > 0) {
            cleaned[key] = res;
          }
        } else {
          cleaned[key] = typeof value === "string" ? value.trim() : value;
        }
      }

      return Object.keys(cleaned).length > 0 ? cleaned : null;
    }

    return isBlankValue(obj, parentKey) ? null : obj;
  };

  const result = cleanObject(data);

  if (Array.isArray(result)) {
    return result.filter((comp) => comp !== null && typeof comp === "object" && Object.keys(comp).length > 0);
  }

  return result;
};

/**
 * Robust JSON parser that handles clean JSON as well as Markdown-wrapped JSON blocks.
 */
export const parseJSONResponse = (text) => {
  if (!text || typeof text !== "string") return text;

  let cleaned = text.trim();

  // Strip markdown code fences if present (```json ... ``` or ``` ...)
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // Attempt extracting substring between first { and last } or first [ and last ]
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
      } catch (nestedErr) {
        // Continue to fallback
      }
    }

    const firstBracket = cleaned.indexOf("[");
    const lastBracket = cleaned.lastIndexOf("]");
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
      try {
        return JSON.parse(cleaned.substring(firstBracket, lastBracket + 1));
      } catch (nestedErr) {
        // Continue to fallback
      }
    }

    logger.warn(`Failed to parse AI response as JSON: ${err.message}`);
    return { rawResponse: text };
  }
};

/**
 * Unified model execution handler for Gemini, OpenAI, and Claude
 */
export const callAIProvider = async ({ providerKey, prompt, systemInstruction }) => {
  const provider = resolveProvider(providerKey);
  const model = getProviderModel(provider);

  logger.info(`Invoking AI Provider: [${provider.toUpperCase()}] with Model: [${model}]`);

  switch (provider) {
    case AI_PROVIDERS.GEMINI: {
      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          ...(systemInstruction ? { systemInstruction } : {}),
        },
      });

      const rawText = response.text || "";
      const usageMetadata = {
        prompt_tokens: response.usageMetadata?.promptTokenCount || 0,
        candidates_tokens: response.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: response.usageMetadata?.totalTokenCount || 0,
      };

      return {
        rawText,
        usageMetadata,
        provider: AI_PROVIDERS.GEMINI,
        model,
      };
    }

    case AI_PROVIDERS.CLAUDE: {
      const anthropic = getClaudeClient();
      const system = systemInstruction || "You are an expert AI business intelligence analyst. You MUST respond with valid, parseable JSON ONLY without any preamble, markdown code fences, or additional text.";

      const response = await anthropic.messages.create({
        model,
        max_tokens: 4096,
        system,
        messages: [
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
      });

      const rawText = response.content?.map((c) => c.text || "").join("") || "";
      const inputTokens = response.usage?.input_tokens || 0;
      const outputTokens = response.usage?.output_tokens || 0;

      const usageMetadata = {
        prompt_tokens: inputTokens,
        candidates_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      };

      return {
        rawText,
        usageMetadata,
        provider: AI_PROVIDERS.CLAUDE,
        model,
      };
    }

    case AI_PROVIDERS.OPENAI:
    default: {
      const openai = getOpenAIClient();
      const messages = [];

      if (systemInstruction) {
        messages.push({ role: "system", content: systemInstruction });
      } else {
        messages.push({
          role: "system",
          content: "You are an expert AI business intelligence analyst. You MUST respond with valid, parseable JSON ONLY, following the requested format.",
        });
      }

      messages.push({ role: "user", content: prompt });

      const requestPayload = {
        model,
        messages,
        response_format: { type: "json_object" },
      };

      // Models like gpt-5*, o1*, o3*, o4*, or nano support reasoning_effort
      const isReasoningModel = /^(gpt-5|o1|o3|o4|o-)/i.test(model) || model.toLowerCase().includes("nano");
      if (!isReasoningModel) {
        requestPayload.temperature = 0.2;
      } else {
        // Drastically speeds up OpenAI reasoning models (gpt-5-nano, o3-mini, etc.)
        requestPayload.reasoning_effort = (process.env.OPENAI_REASONING_EFFORT || "low").trim().toLowerCase();
      }

      const response = await openai.chat.completions.create(requestPayload);

      const rawText = response.choices?.[0]?.message?.content || "";
      const usageMetadata = {
        prompt_tokens: response.usage?.prompt_tokens || 0,
        candidates_tokens: response.usage?.completion_tokens || 0,
        total_tokens: response.usage?.total_tokens || 0,
      };

      return {
        rawText,
        usageMetadata,
        provider: AI_PROVIDERS.OPENAI,
        model,
      };
    }
  }
};

/**
 * Generate insight for a single component table data
 */
export const generateSingleComponentInsight = async ({ componentData, customPrompt, provider }) => {
  const sanitizedData = sanitizeComponentData(componentData);
  const title = componentData.TITLE || componentData.CHART_OUTPUT_LIST?.[0]?.TITLE || "Component Table Data";
  const componentTypeId = componentData.COMPONENT_TYPE_ID || componentData.COMPONENT_ID || null;

  // Check for Incremental Load / Read More metadata
  const isLoadMore = componentData.IS_LOAD_MORE || componentData.is_load_more || componentData.PAGE_NUMBER > 1;
  const pageNumber = componentData.PAGE_NUMBER || componentData.page_number || 1;
  const rowRange = componentData.ROW_RANGE || componentData.row_range || null;

  const contentText = `You are an expert AI business analyst for hospitality & sales data.
Analyze the following single component table data:

COMPONENT DETAILS:
- Title: ${title}
- Component Type ID: ${componentTypeId}
${isLoadMore ? `- LOAD MORE / INCREMENTAL DATA: Page ${pageNumber} ${rowRange ? `(Rows: ${rowRange})` : "(Newly Appended Rows)"}` : ""}

RAW COMPONENT DATA:
\`\`\`json
${JSON.stringify(sanitizedData, null, 2)}
\`\`\`

${isLoadMore ? `NOTE FOR INCREMENTAL LOAD: This payload contains newly loaded rows (Load More / Page ${pageNumber}). Analyze the newly appended data rows specifically and highlight their incremental impact.` : ""}

${customPrompt ? `CUSTOM USER QUESTION / INSTRUCTION:\n${customPrompt}\n` : ""}

CRITICAL RESPONSE REQUIREMENT:
Return a SINGLE JSON OBJECT (not an array) matching this exact format:
{
  "COMPONENT_TYPE_ID": ${componentTypeId},
  "TITLE": "${title}",
  "IS_LOAD_MORE": ${!!isLoadMore},
  "PAGE_NUMBER": ${pageNumber},
  "AI_INSIGHT": {
    "summary": "${isLoadMore ? "Concise summary of newly loaded incremental rows and their impact." : "Concise 2-3 sentence overview of this specific table/component."}",
    "status": "Positive | Warning | Critical | Neutral",
    "status_color": "green | yellow | red | blue",
    "key_findings": [
      "Finding 1 with specific numbers/variances",
      "Finding 2 with specific numbers/variances"
    ],
    "top_highlights": [
      "Highlight 1"
    ],
    "metrics_summary": {
      "total_value": "formatted string if available",
      "variance_vs_budget": "formatted % if available",
      "variance_vs_last_year": "formatted % if available"
    },
    "recommendations": [
      "Actionable recommendation 1"
    ],
    "AI_COMMENTARY": {
      "overview": "Comprehensive executive commentary overview for the AI Commentary widget.",
      "sections": [
        {
          "title": "SECTION TITLE (e.g. PRODUCT DETAILS, CART, CHECKOUT, SALES, COGS, PROFIT)",
          "trend": "up | down | neutral",
          "commentary": "Specific commentary text for this section."
        }
      ]
    }
  }
}
`;

  const aiResult = await callAIProvider({
    providerKey: provider,
    prompt: contentText,
  });

  logger.info("usageMetadata:", aiResult.usageMetadata);

  const parsed = parseJSONResponse(aiResult.rawText);

  if (typeof parsed === "object" && parsed !== null && !parsed.rawResponse) {
    logger.info("parsed insight successfully");
    return {
      result: parsed,
      usageMetadata: aiResult.usageMetadata,
      provider: aiResult.provider,
      model: aiResult.model,
    };
  }

  return {
    result: {
      COMPONENT_TYPE_ID: componentTypeId,
      TITLE: title,
      AI_INSIGHT: {
        summary: typeof parsed?.rawResponse === "string" ? parsed.rawResponse : aiResult.rawText,
        status: "Neutral",
        key_findings: [],
        recommendations: [],
      },
    },
    usageMetadata: aiResult.usageMetadata,
    provider: aiResult.provider,
    model: aiResult.model,
  };
};

/**
 * Process a single batch of components for Executive AI Commentary
 */
const processSingleBatch = async ({ prompt, dataBatch, provider }) => {
  let contentText = "";

  if (dataBatch) {
    contentText += `Below is the input JSON data containing multiple components/objects:\n\`\`\`json\n${JSON.stringify(dataBatch, null, 2)}\n\`\`\`\n\n`;
  }

  if (prompt) {
    contentText += `User Instructions:\n${prompt}\n\n`;
  }

  contentText += `CRITICAL INSTRUCTIONS FOR EXECUTIVE AI COMMENTARY:

You are a Senior AI Business Intelligence Analyst for hospitality and enterprise sales analytics.
Perform an in-depth, data-driven executive analysis across all provided JSON components (e.g. Sales, Category Mix, Menu Profitability, Top/Bottom Sellers, Covers, Costs, or Bubble Chart distributions).

REQUIREMENT FOR OVERVIEW:
Provide an extensive, multi-paragraph executive commentary (250-400 words across 2-4 comprehensive paragraphs).
- Paragraph 1: Executive performance summary covering total revenue/amount contributions, dominant categories (e.g., Food vs Drinks vs Wine), and overall profitability drivers.
- Paragraph 2: In-depth product mix & item dynamics highlighting standout top contributors and bottom-performing/low-velocity items with exact figures and percentages.
- Paragraph 3: Operational risks, margin opportunities, or structural volume patterns observed in the data.

Return a SINGLE CONSOLIDATED JSON OBJECT matching this exact structure:

{
  "title": "Executive AI Commentary",
  "ai_commentary": {
    "overview": "Detailed multi-paragraph executive analysis synthesizing key financial metrics, category breakdowns, top and bottom performers, and revenue mix from the provided dataset.",
    "status": "Critical | Warning | Positive | Neutral",
    "status_color": "red | yellow | green | blue",
    "key_findings": [
      "High-impact data finding 1 with exact figures (£/count/%) from the data",
      "High-impact data finding 2 with exact figures (£/count/%) from the data",
      "High-impact data finding 3 with exact figures (£/count/%) from the data",
      "High-impact data finding 4 with exact figures (£/count/%) from the data",
      "High-impact data finding 5 with exact figures (£/count/%) from the data"
    ],
    "recommendations": [
      "Strategic actionable recommendation 1 based on the data",
      "Strategic actionable recommendation 2 based on the data",
      "Strategic actionable recommendation 3 based on the data",
      "Strategic actionable recommendation 4 based on the data"
    ]
  }
}

STRICT CONSTRAINTS:
1. Do NOT include any "sections" array.
2. Provide 4-6 specific key findings and 3-5 concrete recommendations.
3. Every finding MUST cite exact metrics, labels, and numbers from the provided input data.
`;

  console.log("PAYLOAD SENT TO AI PROVIDER ====================", JSON.stringify(dataBatch, null, 2));

  const aiResult = await callAIProvider({
    providerKey: provider,
    prompt: contentText,
  });

  const parsed = parseJSONResponse(aiResult.rawText);

  return {
    result: parsed,
    usageMetadata: aiResult.usageMetadata,
    provider: aiResult.provider,
    model: aiResult.model,
  };
};

/**
 * Main function to generate multi-component executive summary response.
 * Handles large payload batching across any selected provider.
 */
export const generateResponse = async ({ prompt, data, provider }) => {
  const sanitizedData = sanitizeComponentData(data);

  if (Array.isArray(sanitizedData) && sanitizedData.length > 20) {
    logger.info(`Large payload detected (${sanitizedData.length} components). Batching into parallel chunks of 20 components...`);
    const chunkSize = 20;
    const batches = [];

    for (let i = 0; i < sanitizedData.length; i += chunkSize) {
      batches.push(sanitizedData.slice(i, i + chunkSize));
    }

    const batchResults = await Promise.all(
      batches.map((dataBatch) => processSingleBatch({ prompt, dataBatch, provider }))
    );

    const mergedResult = [];
    const aggregatedUsage = { prompt_tokens: 0, candidates_tokens: 0, total_tokens: 0 };
    let finalProvider = null;
    let finalModel = null;

    for (const batchRes of batchResults) {
      if (Array.isArray(batchRes.result)) {
        mergedResult.push(...batchRes.result);
      } else {
        mergedResult.push(batchRes.result);
      }

      aggregatedUsage.prompt_tokens += batchRes.usageMetadata.prompt_tokens;
      aggregatedUsage.candidates_tokens += batchRes.usageMetadata.candidates_tokens;
      aggregatedUsage.total_tokens += batchRes.usageMetadata.total_tokens;
      finalProvider = batchRes.provider;
      finalModel = batchRes.model;
    }

    logger.info(`Successfully processed ${sanitizedData.length} components across ${batches.length} parallel batches.`);
    return {
      result: mergedResult,
      usageMetadata: aggregatedUsage,
      provider: finalProvider,
      model: finalModel,
    };
  }

  return processSingleBatch({ prompt, dataBatch: sanitizedData, provider });
};

export default {
  sanitizeComponentData,
  parseJSONResponse,
  callAIProvider,
  generateSingleComponentInsight,
  generateResponse,
};
