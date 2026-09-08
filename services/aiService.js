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
  "EXPORT_FLAG", "PROCESSING_FLAG", "EMAIL_SCHEDULE_ID",
  "BRANCH_ID", "branch_id", "BRANCHID", "BranchId", "branchId",
  "DIM_KEY", "dim_key", "DIMKEY", "DimKey", "dimKey",
  "SortOrder", "sortOrder", "Sort_Order", "SORT_ORDER", "SORTORDER", "sort_order",
  "settingsTable", "settingstable", "SETTINGSTABLE", "SettingsTable",
  "GridOutputobj", "gridOutputobj", "GRIDOUTPUTOBJ",
  "weekList", "weeklist", "WEEKLIST", "WeekList",
  "RevenueCenterHeaderList", "revenueCenterHeaderList", "REVENUECENTERHEADERLIST", "Revenuecenterheaderlist",
  "dimensionNameByKey", "dimensionnamebykey", "DIMENSIONNAMEBYKEY", "DimensionNameByKey",
  "listvalue", "listValue", "LISTVALUE", "ListValue",
  "IS_AVERAGE_CLS", "is_average_cls", "isAverageCls",
  "SALES_DEM_COUNT", "COVERS_DEM_COUNT", "SPH_DEM_COUNT", "SALES_COUNT", "COVERS_COUNT", "SPH_COUNT", "LY_LW_ROW_COUNT", "DEM_COUNT",
  "Val4", "Val5", "Val6", "Val7", "Val8", "Val9", "Val10", "Val11", "Val12", "Val13", "Val14", "Val15", "Val16", "Val17", "Val18", "Val19", "Val20", "Val21", "Val22", "Val23", "Val24", "Val25", "Val26",
  "Val31", "Val32", "Val33", "Val34", "Val35", "Val36", "Val37", "Val38",
  "d_NET", "d_COVERS", "d_YTDCovers", "d_AvgSPH", "d_LYGrossSales", "d_LYCovers", "d_LYAvgSPH", "d_GROSS", "d_SPH", "d_LY_NET", "d_LY_GROSS",
  "CW_UP_DOWN", "LW_UP_DOWN", "SORT_ORDER",
  "VARIANCE_PERCENT_VALUE",
  "IS_LOAD_MORE", "PAGE_NUMBER", "ROW_COUNT", "TOTAL_ROWS",
  "HEADER_NAME", "header_name", "LABELS", "labels",
  "ID", "id", "Id",
  "SHOW_DETAILS", "SHOWDETAILS", "DRILLDOWN", "DRILL_DOWN"
]);

const DESCRIPTOR_KEYS = new Set([
  "NAME", "name", "TITLE", "title", "LABEL", "label", "KEY", "key",
  "DIMENSION", "dimension", "DIMENSION_BY", "dimension_by",
  "VARIANCE_TEXT", "variance_text", "SESSION", "session", "CATEGORY", "category",
  "PERIOD", "period", "DATE", "date", "HEADER", "header", "COMPONENT_TYPE_ID", "GRID_TITLE"
]);

/**
 * Normalizes input data payloads:
 * Handles nested arrays (e.g. [[{...}]], [[[ {...} ]]], [[comp1], [comp2]]),
 * unwrapping outer container arrays while preserving component objects.
 */
export const normalizeDataPayload = (data) => {
  if (data === null || data === undefined) return data;

  let current = data;

  // Recursively unwrap single-element wrapper arrays (e.g. [[[{...}]]] -> [{...}])
  while (Array.isArray(current) && current.length === 1 && Array.isArray(current[0])) {
    current = current[0];
  }

  // If current is an array containing nested arrays, flatten completely
  if (Array.isArray(current) && current.some((item) => Array.isArray(item))) {
    current = current.flat(Infinity);
  }

  // Filter out any null/undefined items from array
  if (Array.isArray(current)) {
    return current.filter((item) => item !== null && item !== undefined);
  }

  return current;
};

/**
 * Strips artificial prefixes like "Finding 1:", "Finding 1 (highest impact):",
 * "Recommendation 1:", "1.", "-", "*", etc., from insight items.
 */
export const cleanInsightItem = (item) => {
  if (typeof item !== "string") return String(item || "");
  let text = item.trim();
  // Strip prefixes like "Finding 1:", "Finding 1 (highest impact):", "Recommendation 1:", "Key Finding 1:", "Action 1:", "1.", "-", etc.
  text = text
    .replace(/^(?:Key\s+Finding|Finding|Recommendation|Action|Insight)\s*\d*\s*(?:\([^)]*\))?\s*[:\-–—]?\s*/i, "")
    .replace(/^\([^)]*(?:impact|priority|finding|recommendation)[^)]*\)\s*[:\-–—]?\s*/i, "")
    .replace(/^[-*•]\s*/, "")
    .replace(/^\d+[\.\)]\s*/, "")
    .replace(/^[:\-–—]\s*/, "")
    .trim();

  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }
  return text;
};

export const cleanInsightList = (list) => {
  if (!Array.isArray(list)) return [];
  return list
    .map(cleanInsightItem)
    .filter((item) => item.length > 0);
};

/**
 * Ensures any AI output conforms strictly to the standardized Executive AI Commentary schema:
 * {
 *   "title": "Executive AI Commentary",
 *   "ai_commentary": {
 *     "overview": "...",
 *     "status": "Critical | Warning | Positive | Neutral",
 *     "status_color": "red | yellow | green | blue",
 *     "key_findings": [...],
 *     "recommendations": [...]
 *   }
 * }
 */
export const normalizeAICommentaryResult = (parsed, rawText = "") => {
  // If parsed is already properly structured
  if (parsed && typeof parsed === "object" && parsed.ai_commentary) {
    const comm = parsed.ai_commentary;
    return {
      title: parsed.title || "Executive AI Commentary",
      ai_commentary: {
        overview: comm.overview || comm.summary || "",
        status: comm.status || "Neutral",
        status_color: comm.status_color || "blue",
        key_findings: cleanInsightList(comm.key_findings),
        recommendations: cleanInsightList(comm.recommendations),
      },
    };
  }

  // If parsed has AI_INSIGHT (legacy model response or schema variation)
  if (parsed && typeof parsed === "object" && parsed.AI_INSIGHT) {
    const insight = parsed.AI_INSIGHT;
    return {
      title: "Executive AI Commentary",
      ai_commentary: {
        overview: insight.summary || insight.overview || insight.AI_COMMENTARY?.overview || "",
        status: insight.status || "Neutral",
        status_color: insight.status_color || "blue",
        key_findings: cleanInsightList(insight.key_findings),
        recommendations: cleanInsightList(insight.recommendations),
      },
    };
  }

  // If parsed is a flat commentary object without outer title wrapper
  if (parsed && typeof parsed === "object" && (parsed.overview || parsed.key_findings || parsed.recommendations)) {
    return {
      title: parsed.title || "Executive AI Commentary",
      ai_commentary: {
        overview: parsed.overview || parsed.summary || "",
        status: parsed.status || "Neutral",
        status_color: parsed.status_color || "blue",
        key_findings: cleanInsightList(parsed.key_findings),
        recommendations: cleanInsightList(parsed.recommendations),
      },
    };
  }

  // Fallback for unparseable raw string
  return {
    title: "Executive AI Commentary",
    ai_commentary: {
      overview: typeof parsed?.rawResponse === "string" ? parsed.rawResponse : rawText,
      status: "Neutral",
      status_color: "blue",
      key_findings: [],
      recommendations: [],
    },
  };
};

/**
 * Universally sanitizes any component or arbitrary business data structure:
 * 1. Strips all `null`, `undefined`, empty strings `""`, whitespace-only strings, "null", "undefined", "n/a", "nan", "-", "--".
 * 2. Strips all 0 / 0.00 / 0% / false values.
 * 3. Strips internal SQL execution configurations, file paths, IDs, UI styling, and toggle metadata.
 * 4. Filters out row entries in arrays that contain only descriptor names without any actual non-zero metrics.
 * 5. Recursively removes empty objects `{}` and empty arrays `[]`.
 */
export const sanitizeComponentData = (data) => {
  if (data === null || data === undefined) return null;

  const normalized = normalizeDataPayload(data);

  const isBlankValue = (val) => {
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
        lower === "--" ||
        lower === "0" ||
        lower === "0.0" ||
        lower === "0.00" ||
        lower === "0%" ||
        lower === "0.0%" ||
        lower === "0.00%" ||
        lower === "0.00 %"
      ) {
        return true;
      }
      return false;
    }

    if (typeof val === "number") {
      return val === 0 || isNaN(val);
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

  const cleanObject = (obj) => {
    if (obj === null || obj === undefined) return null;

    if (Array.isArray(obj)) {
      if (isEmptySeries(obj)) return null;

      const cleanedArr = obj
        .map((item) => cleanObject(item))
        .filter((item) => {
          if (item === null || item === undefined) return false;
          if (typeof item === "string" && isBlankValue(item)) return false;
          if (typeof item === "object") {
            if (Array.isArray(item)) return item.length > 0;
            const keys = Object.keys(item);
            if (keys.length === 0) return false;
            // If row only has descriptor keys (e.g. { NAME: "Breakfast" }) without any actual metric/value fields, drop it
            const onlyDescriptors = keys.every((k) => DESCRIPTOR_KEYS.has(k));
            if (onlyDescriptors) return false;
            return true;
          }
          return !isBlankValue(item);
        });

      return cleanedArr.length > 0 ? cleanedArr : null;
    }

    if (typeof obj === "object") {
      const cleaned = {};
      for (const [key, value] of Object.entries(obj)) {
        if (IGNORED_METADATA_KEYS.has(key)) continue;

        // Skip duplicate root DISPLAY_DATA if BUBBLECHARTDATALIST exists
        if (key === "DISPLAY_DATA" && obj.BUBBLECHARTDATALIST) continue;

        // Skip root-level UI column mapping lists if GridOutputList/GridOutputlist exists
        if ((key === "CatList" || key === "catList") && (obj.GridOutputList || obj.GridOutputlist || obj.gridOutputList || obj.gridOutputlist)) continue;

        if (isBlankValue(value)) continue;

        // In ChangeViewobj or settings objects, ignore internal boolean flags & numeric codes
        if (key === "ChangeViewobj" && typeof value === "object" && value !== null) {
          const viewObj = {};
          if (value.VARIANCE_TEXT && !isBlankValue(value.VARIANCE_TEXT)) viewObj.VARIANCE_TEXT = value.VARIANCE_TEXT;
          if (value.DIMENSION_BY && !isBlankValue(value.DIMENSION_BY)) viewObj.DIMENSION_BY = value.DIMENSION_BY;
          if (Object.keys(viewObj).length > 0) {
            cleaned[key] = viewObj;
          }
          continue;
        }

        if (Array.isArray(value)) {
          if (isEmptySeries(value)) continue;
          const cleanedArr = cleanObject(value);
          if (cleanedArr !== null && cleanedArr.length > 0) {
            cleaned[key] = cleanedArr;
          }
          continue;
        }

        if (typeof value === "object" && value !== null) {
          const res = cleanObject(value);
          if (res !== null && Object.keys(res).length > 0) {
            cleaned[key] = res;
          }
        } else {
          cleaned[key] = typeof value === "string" ? value.trim() : value;
        }
      }

      return Object.keys(cleaned).length > 0 ? cleaned : null;
    }

    return isBlankValue(obj) ? null : obj;
  };

  const result = cleanObject(normalized);

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
3. Sentence Case & Clean Text: Use sentence case for all insight text. Every sentence and bullet point must begin with a capital letter and end with proper punctuation. Do NOT prefix bullet points or list items with labels such as "Finding 1:", "Finding 2:", "Recommendation 1:", "1.", "2.", or bullet markers (- or *). Return clean, direct narrative sentences.
4. Business Overview Word Count & Length: Business Overview must be strictly limited to 60–80 words and a maximum of 4 sentences.
5. Business Overview Content Structure: Business Overview should only explain:
   - Sentence 1: Overall performance
   - Sentence 2: The strongest positive
   - Sentence 3: The biggest concern
   - Sentence 4: The overall takeaway
6. Key Findings Limit & Ranking: Generate a maximum of 4 Key Findings, ranked strictly by business impact (highest impact first).
7. Key Finding Structure: Each Key Finding must clearly explain: (a) what happened, (b) the important supporting number/metric, and (c) why it matters to the business as a clean, direct sentence without "Finding X:" prefixes.
8. Recommendations Limit & Finding Connection: Generate a maximum of 3 Recommendations, and directly connect each recommendation to a specific key finding as a clean, actionable sentence without "Recommendation X:" prefixes.
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
 * Generate insight for single or multiple components.
 * Retained for backward-compatibility; returns the exact same standardized Executive AI Commentary structure.
 */
export const generateSingleComponentInsight = async ({ componentData, customPrompt, provider }) => {
  return generateResponse({ prompt: customPrompt, data: componentData, provider });
};

/**
 * Splits a single large component into smaller sub-components if its row arrays
 * (e.g. GridOutputlist, CHART_OUTPUT_LIST, series) exceed character budget.
 */
const splitLargeComponentIfNeeded = (comp, maxChars = 80000) => {
  if (!comp || typeof comp !== "object" || Array.isArray(comp)) return [comp];
  const compStr = JSON.stringify(comp);
  if (compStr.length <= maxChars) return [comp];

  // Check for common large array properties
  const arrayKey = ["GridOutputList", "GridOutputlist", "gridOutputList", "gridOutputlist", "CHART_OUTPUT_LIST", "chart_output_list", "series", "data", "rows"]
    .find((k) => Array.isArray(comp[k]) && comp[k].length > 1);

  if (!arrayKey) return [comp];

  const list = comp[arrayKey];
  const chunkSize = Math.max(1, Math.ceil(list.length / Math.ceil(compStr.length / maxChars)));
  const chunks = [];

  for (let i = 0; i < list.length; i += chunkSize) {
    const subComp = { ...comp, [arrayKey]: list.slice(i, i + chunkSize) };
    chunks.push(subComp);
  }

  return chunks;
};

/**
 * Process a single batch of components for Executive AI Commentary
 */
const processSingleBatch = async ({ prompt, dataBatch, provider }) => {
  let contentText = "";

  if (dataBatch) {
    const jsonStr = JSON.stringify(dataBatch);
    // Hard safety cap at 1.5MB to ensure it never breaches provider limits
    const safeJsonStr = jsonStr.length > 1500000 ? jsonStr.slice(0, 1500000) + '...[truncated]' : jsonStr;
    contentText += `Below is the input JSON data component(s) / analytics data:\n\`\`\`json\n${safeJsonStr}\n\`\`\`\n\n`;
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
      "Highest impact finding: explain what happened, supporting number, and why it matters as a direct narrative sentence.",
      "Second finding: explain what happened, supporting number, and why it matters as a direct narrative sentence.",
      "Third finding: explain what happened, supporting number, and why it matters as a direct narrative sentence.",
      "Fourth finding: explain what happened, supporting number, and why it matters as a direct narrative sentence."
    ],
    "recommendations": [
      "Specific, actionable step directly connected to finding 1 without generic buzzwords.",
      "Specific, actionable step directly connected to finding 2 without generic buzzwords.",
      "Specific, actionable step directly connected to finding 3 without generic buzzwords."
    ]
  }
}

STRICT CONSTRAINTS:
1. Do NOT include any "sections" array.
2. Overview MUST be strictly 60–80 words and maximum 4 sentences.
3. Provide a MAXIMUM of 4 Key Findings, ranked by business impact. Each must state what happened, supporting number, and why it matters.
4. Provide a MAXIMUM of 3 Recommendations, directly connected to findings and specific/actionable.
5. Do NOT prefix findings or recommendations with "Finding 1:", "Finding 2:", "Recommendation 1:", "1.", "2.", or any bullet markers. Each item must be a clean, direct sentence.
6. Adhere strictly to all 18 AI Insight Generation Rules.
`;

  logger.info(`Payload sent to AI Provider [${provider.toUpperCase()}]: ${contentText.length} characters`);

  const aiResult = await callAIProvider({
    providerKey: provider,
    prompt: contentText,
  });

  const parsed = parseJSONResponse(aiResult.rawText);

  return {
    result: normalizeAICommentaryResult(parsed, aiResult.rawText),
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
  const normalizedData = normalizeDataPayload(data);
  const sanitizedData = sanitizeComponentData(normalizedData);

  if (!sanitizedData) {
    return {
      result: normalizeAICommentaryResult({
        ai_commentary: {
          overview: "No active restaurant performance data was found in the provided payload after removing zero/blank metrics.",
          status: "Neutral",
          status_color: "blue",
          key_findings: ["All provided metrics contained zero, null, or inactive values."],
          recommendations: ["Ensure active operational and sales data is captured for the selected period."],
        },
      }),
      usageMetadata: { prompt_tokens: 0, candidates_tokens: 0, total_tokens: 0 },
      provider: resolveProvider(provider),
      model: getProviderModel(resolveProvider(provider)),
    };
  }

  // Expand array of components if any single component has large nested row arrays
  let componentList = [];
  if (Array.isArray(sanitizedData)) {
    for (const comp of sanitizedData) {
      componentList.push(...splitLargeComponentIfNeeded(comp));
    }
  } else if (typeof sanitizedData === "object") {
    componentList = splitLargeComponentIfNeeded(sanitizedData);
  } else {
    componentList = [sanitizedData];
  }

  // Partition components into size-budgeted batches
  const MAX_BATCH_CHARS = 80000;
  const MAX_BATCH_ITEMS = 10;
  const batches = [];
  let currentBatch = [];
  let currentBatchLength = 0;

  for (const comp of componentList) {
    const compLength = JSON.stringify(comp).length;
    if (
      currentBatch.length >= MAX_BATCH_ITEMS ||
      (currentBatchLength + compLength > MAX_BATCH_CHARS && currentBatch.length > 0)
    ) {
      batches.push(currentBatch);
      currentBatch = [comp];
      currentBatchLength = compLength;
    } else {
      currentBatch.push(comp);
      currentBatchLength += compLength;
    }
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  if (batches.length > 1) {
    logger.info(`Large payload detected (${componentList.length} items across ${batches.length} batches). Processing in parallel...`);

    const batchResults = await Promise.all(
      batches.map((dataBatch) => processSingleBatch({ prompt, dataBatch, provider }))
    );

    const aggregatedUsage = { prompt_tokens: 0, candidates_tokens: 0, total_tokens: 0 };
    let finalProvider = null;
    let finalModel = null;

    const mergedFindings = [];
    const mergedRecommendations = [];
    const statuses = [];
    let primaryOverview = "";

    for (const batchRes of batchResults) {
      const comm = batchRes.result?.ai_commentary;
      if (comm) {
        if (!primaryOverview && comm.overview) primaryOverview = comm.overview;
        if (comm.status) statuses.push(comm.status);
        if (Array.isArray(comm.key_findings)) mergedFindings.push(...comm.key_findings);
        if (Array.isArray(comm.recommendations)) mergedRecommendations.push(...comm.recommendations);
      }

      aggregatedUsage.prompt_tokens += batchRes.usageMetadata?.prompt_tokens || 0;
      aggregatedUsage.candidates_tokens += batchRes.usageMetadata?.candidates_tokens || 0;
      aggregatedUsage.total_tokens += batchRes.usageMetadata?.total_tokens || 0;
      finalProvider = batchRes.provider;
      finalModel = batchRes.model;
    }

    const statusPriority = { Critical: 4, Warning: 3, Positive: 2, Neutral: 1 };
    const bestStatus = statuses.sort((a, b) => (statusPriority[b] || 0) - (statusPriority[a] || 0))[0] || "Neutral";
    const statusColorMap = { Critical: "red", Warning: "yellow", Positive: "green", Neutral: "blue" };

    const consolidatedResult = {
      title: "Executive AI Commentary",
      ai_commentary: {
        overview: primaryOverview || "Consolidated executive commentary across all component batches.",
        status: bestStatus,
        status_color: statusColorMap[bestStatus] || "blue",
        key_findings: cleanInsightList(mergedFindings).slice(0, 4),
        recommendations: cleanInsightList(mergedRecommendations).slice(0, 3),
      },
    };

    logger.info(`Successfully processed ${componentList.length} components across ${batches.length} parallel batches.`);
    return {
      result: consolidatedResult,
      usageMetadata: aggregatedUsage,
      provider: finalProvider,
      model: finalModel,
    };
  }

  // Single batch
  const singleBatchData = batches.length === 1
    ? (Array.isArray(sanitizedData) ? batches[0] : (batches[0].length === 1 ? batches[0][0] : batches[0]))
    : sanitizedData;

  return processSingleBatch({ prompt, dataBatch: singleBatchData, provider });
};

export default {
  normalizeDataPayload,
  normalizeAICommentaryResult,
  sanitizeComponentData,
  parseJSONResponse,
  callAIProvider,
  generateSingleComponentInsight,
  generateResponse,
};
