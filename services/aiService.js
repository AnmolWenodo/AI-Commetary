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
 * Configurable significance threshold (e.g. ±5%)
 */
export const SIGNIFICANCE_THRESHOLD_PERCENT = 5;

/**
 * 18 Core AI Insight Generation Rules for Hospitality & Restaurant Analytics
 */
export const AI_INSIGHT_RULES = `
AI INSIGHT GENERATION RULES (STRICT COMPLIANCE REQUIRED):
1. Simple Language: Use simple, everyday business language that restaurant managers can understand easily. Avoid technical, academic, or complex statistical jargon.
2. No Internal/System Terms: Never display internal field names, coded values, database labels, system terminology, or raw variable names with underscores (e.g., never say LW_UP, LY_SALES, COMP_ID, BUBBLECHARTDATALIST, Val1). Always convert them to clean, human-readable restaurant terms.
3. Sentence Case: Use sentence case for all insight text. Every sentence and bullet point must begin with a capital letter and end with proper punctuation.
4. Business Overview Word Count & Length: Business Overview must be strictly limited to 60–80 words and a maximum of 4 sentences.
5. Business Overview Content Structure: Business Overview should only explain:
   - Sentence 1: Overall performance
   - Sentence 2: The strongest positive
   - Sentence 3: The biggest concern
   - Sentence 4: The overall takeaway
6. Key Findings Limit & Ranking: Generate a maximum of 4 Key Findings, ranked strictly by business impact (highest impact first).
7. Key Finding Structure: Each Key Finding must clearly explain: (a) what happened, (b) the important supporting number/metric, and (c) why it matters to the business.
8. Recommendations Limit & Finding Connection: Generate a maximum of 3 Recommendations, and directly connect each recommendation to a specific key finding.
9. Specific & Actionable: Recommendations must be specific and actionable. Avoid generic words such as "optimise", "leverage", "strengthen", or "monitor" without explaining the concrete action the user should actually take.
10. Zero Redundancy: Do not repeat the same information across Business Overview, Key Findings, and Recommendations. Keep each section distinct.
11. Selective Highlighting: Do not narrate every table or KPI. Highlight only meaningful changes, exceptions, risks, and opportunities.
12. Significance Threshold: Ignore insignificant movements unless they affect an important KPI. Disregard minor variations within ±5%.
13. Data-Supported Causality: Never invent reasons for performance changes (e.g., do not speculate about weather, holidays, or staff issues unless explicitly provided in the data). Only state causes supported by the supplied data.
14. No Comparison on Zero/Missing: Do not calculate or discuss comparisons, growth rates, or variances when the comparison/baseline value is zero, missing, null, or unavailable.
15. Restaurant Terminology: Prefer restaurant terminology such as Sales, Covers, Spend per Guest, Food, Drinks, Revenue Centre, and Session over generic analytical terminology.
16. Consistent Number Formatting: Format percentages (e.g., +8.5%, -3.2%), currencies (e.g., £1,240, $5,600), and numbers consistently, and round unnecessary decimal places.
17. No Number Repetition: Avoid repeating the same number multiple times within the AI insight section.
18. Context-Aware Recommendations: Recommendations must consider operational context. For example, low sales alone should not lead to a recommendation to remove a menu item without margin or profitability information.
`;

const SYSTEM_INSTRUCTION_BASE = `You are an expert AI business intelligence analyst specializing in restaurant, hospitality, and sales analytics. You MUST strictly adhere to the AI Insight Generation Rules and respond with valid, parseable JSON ONLY without any markdown code fences, preamble, or conversational filler.\n${AI_INSIGHT_RULES}`;

/**
 * Unified model execution handler for Gemini, OpenAI, and Claude
 */
export const callAIProvider = async ({ providerKey, prompt, systemInstruction }) => {
  const provider = resolveProvider(providerKey);
  const model = getProviderModel(provider);
  const effectiveSystemInstruction = systemInstruction || SYSTEM_INSTRUCTION_BASE;

  logger.info(`Invoking AI Provider: [${provider.toUpperCase()}] with Model: [${model}]`);

  switch (provider) {
    case AI_PROVIDERS.GEMINI: {
      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          systemInstruction: effectiveSystemInstruction,
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

      const response = await anthropic.messages.create({
        model,
        max_tokens: 4096,
        system: effectiveSystemInstruction,
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
      const messages = [
        { role: "system", content: effectiveSystemInstruction },
        { role: "user", content: prompt },
      ];

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

  const contentText = `You are an expert AI business analyst for hospitality, restaurant management, and sales data.
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

${AI_INSIGHT_RULES}

CRITICAL RESPONSE REQUIREMENT:
Return a SINGLE JSON OBJECT (not an array) matching this exact format:
{
  "COMPONENT_TYPE_ID": ${componentTypeId},
  "TITLE": "${title}",
  "IS_LOAD_MORE": ${!!isLoadMore},
  "PAGE_NUMBER": ${pageNumber},
  "AI_INSIGHT": {
    "summary": "Strictly 60-80 words and max 4 sentences explaining: 1) overall performance, 2) strongest positive, 3) biggest concern, and 4) overall takeaway.",
    "status": "Positive | Warning | Critical | Neutral",
    "status_color": "green | yellow | red | blue",
    "key_findings": [
      "Maximum of 4 findings ranked by impact. Each finding must explain: what happened, supporting number, and why it matters."
    ],
    "top_highlights": [
      "Key highlight in sentence case"
    ],
    "metrics_summary": {
      "total_value": "formatted string if available",
      "variance_vs_budget": "formatted % if available and non-zero baseline",
      "variance_vs_last_year": "formatted % if available and non-zero baseline"
    },
    "recommendations": [
      "Maximum of 3 specific and actionable recommendations directly connected to findings without generic buzzwords."
    ],
    "AI_COMMENTARY": {
      "overview": "Concise executive overview (60-80 words, max 4 sentences) for the commentary widget.",
      "sections": [
        {
          "title": "SECTION TITLE (e.g. Sales, Covers, Food, Drinks, Spend per Guest)",
          "trend": "up | down | neutral",
          "commentary": "Specific commentary text in sentence case."
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

You are a Senior AI Business Intelligence Analyst for hospitality and restaurant sales analytics.
Perform an in-depth, data-driven executive analysis across all provided JSON components (e.g. Sales, Covers, Spend per Guest, Food & Drinks Category Mix, Menu Profitability, Top/Bottom Sellers, Revenue Centres, or Sessions).

${AI_INSIGHT_RULES}

Return a SINGLE CONSOLIDATED JSON OBJECT matching this exact structure:

{
  "title": "Executive AI Commentary",
  "ai_commentary": {
    "overview": "Business Overview strictly 60–80 words and maximum 4 sentences. Sentence 1: overall performance. Sentence 2: strongest positive. Sentence 3: biggest concern. Sentence 4: overall takeaway.",
    "status": "Critical | Warning | Positive | Neutral",
    "status_color": "red | yellow | green | blue",
    "key_findings": [
      "Finding 1 (highest impact): explain what happened, supporting number, and why it matters.",
      "Finding 2: explain what happened, supporting number, and why it matters.",
      "Finding 3: explain what happened, supporting number, and why it matters.",
      "Finding 4: explain what happened, supporting number, and why it matters."
    ],
    "recommendations": [
      "Recommendation 1: specific, actionable step directly connected to finding 1 without generic buzzwords.",
      "Recommendation 2: specific, actionable step directly connected to finding 2 without generic buzzwords.",
      "Recommendation 3: specific, actionable step directly connected to finding 3 without generic buzzwords."
    ]
  }
}

STRICT CONSTRAINTS:
1. Do NOT include any "sections" array.
2. Overview MUST be strictly 60–80 words and maximum 4 sentences.
3. Provide a MAXIMUM of 4 Key Findings, ranked by business impact. Each must state what happened, supporting number, and why it matters.
4. Provide a MAXIMUM of 3 Recommendations, directly connected to findings and specific/actionable.
5. Adhere strictly to all 18 AI Insight Generation Rules.
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
