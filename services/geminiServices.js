import ai from "../config/gemini.js";
import logger from "../config/logger.js";


/**
 * Deeply sanitizes component data to drastically reduce token consumption:
 * 1. Removes null, undefined, false, and empty string "" properties.
 * 2. Removes 0.0 / zero-value uninformative metric fields.
 * 3. Removes empty objects {} and empty arrays [].
 * 4. Removes series arrays containing only zeros [0, 0, 0, ...] or nulls.
 * 5. Filters out component objects that contain no active data.
 */
const sanitizeComponentData = (data) => {
  if (data === null || data === undefined) return null;

  const isBlankValue = (val) => {
    if (val === null || val === undefined || val === "" || val === false) return true;
    if (val === 0 || val === 0.0 || val === "0" || val === "0.0" || val === "0%" || val === "0.0%") return true;
    return false;
  };

  const isEmptySeries = (arr) => {
    if (!Array.isArray(arr)) return false;
    return arr.length === 0 || arr.every(val => isBlankValue(val));
  };

  const cleanObject = (obj) => {
    if (Array.isArray(obj)) {
      if (isEmptySeries(obj)) return null;
      const cleanedArr = obj
        .map(cleanObject)
        .filter(item => {
          if (item === null || item === undefined) return false;
          if (typeof item === "object" && Object.keys(item).length === 0) return false;
          return true;
        });
      return cleanedArr.length > 0 ? cleanedArr : null;
    }

    if (typeof obj === "object" && obj !== null) {
      const cleaned = {};
      for (const [key, value] of Object.entries(obj)) {
        // Essential identifier keys to keep even if 0
        const isEssentialKey = key === "COMPONENT_TYPE_ID" || key === "COMPONENT_ID" || key === "Val1";

        if (!isEssentialKey && isBlankValue(value)) continue;

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
          cleaned[key] = value;
        }
      }
      return Object.keys(cleaned).length > 0 ? cleaned : null;
    }

    return obj;
  };

  const result = cleanObject(data);

  if (Array.isArray(result)) {
    return result.filter(comp => comp !== null && typeof comp === "object" && Object.keys(comp).length > 0);
  }

  return result;
};

export const generateSingleComponentInsight = async ({ componentData, customPrompt }) => {
  const sanitizedData = sanitizeComponentData(componentData);
  const title = componentData.TITLE || componentData.CHART_OUTPUT_LIST?.[0]?.TITLE || "Component Table Data";
  console.log("title:", title);
  const componentTypeId = componentData.COMPONENT_TYPE_ID || componentData.COMPONENT_ID || null;
  console.log("componentTypeId:", componentTypeId);

  // Check for Incremental Load / Read More metadata
  const isLoadMore = componentData.IS_LOAD_MORE || componentData.is_load_more || componentData.PAGE_NUMBER > 1;
  const pageNumber = componentData.PAGE_NUMBER || componentData.page_number || 1;
  const rowRange = componentData.ROW_RANGE || componentData.row_range || null;

  let contentText = `You are an expert AI business analyst for hospitality & sales data.
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


  // console.log(JSON.stringify(sanitizedData, null, 2));

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
    contents: contentText,
    config: {
      responseMimeType: "application/json",
    },
  });


  const usageMetadata = {
    prompt_tokens: response.usageMetadata?.promptTokenCount || 0,
    candidates_tokens: response.usageMetadata?.candidatesTokenCount || 0,
    total_tokens: response.usageMetadata?.totalTokenCount || 0,
  };

  logger.info("usageMetadata:", usageMetadata);

  try {
    const parsed = JSON.parse(response.text);
    logger.info("parsed:", parsed);
    return { result: parsed, usageMetadata };
  } catch (parseError) {
    return {
      result: {
        COMPONENT_TYPE_ID: componentTypeId,
        TITLE: title,
        AI_INSIGHT: {
          summary: response.text,
          status: "Neutral",
          key_findings: [],
          recommendations: []
        }
      },
      usageMetadata
    };
  }
};

const processSingleBatch = async ({ prompt, dataBatch }) => {
  let contentText = "";

  if (dataBatch) {
    contentText += `Below is the input JSON data containing multiple components/objects:\n\`\`\`json\n${JSON.stringify(dataBatch, null, 2)}\n\`\`\`\n\n`;
  }

  if (prompt) {
    contentText += `User Instructions:\n${prompt}\n\n`;
  }

  contentText += `CRITICAL INSTRUCTIONS FOR EXTENSIVE, IN-DEPTH EXECUTIVE AI COMMENTARY:

You are a Senior AI Business Intelligence Analyst for hospitality and enterprise sales data.
You MUST perform an exhaustive data mining across ALL provided JSON components (Sales, Profitability, Staff Costs, COGS, Covers, Site Performance, Product Mix, SPH Trends, Trading Outages, etc.).

REQUIREMENT FOR OVERVIEW LENGTH:
The "overview" field MUST be an EXTENSIVE, HIGHLY-DETAILED, MULTI-PARAGRAPH ANALYSIS (at least 400 to 600 words across 4-5 paragraphs). Do NOT return a short or brief summary. 

Format the "overview" text into distinct, comprehensive paragraphs covering:
- Paragraph 1 (Executive Financial Performance): Deep dive into YTD Sales, YTD Guest Covers, YTD Net & Gross Profitability, COGS, Staff Costs, and overall YoY / WoW percentage variances with exact currency figures (£).
- Paragraph 2 (Trading Outages & Weekly Timeline Analysis): Mine weekly trend numbers across all 52 weeks. Analyze peak trading periods (e.g. Weeks 1–22) versus shutdown/blackout weeks (e.g. Weeks 23–29) and initial restart figures in Week 30.
- Paragraph 3 (Site Performance & Location Variations): Provide site-by-site comparative analysis (e.g. Bristol vs London vs Manchester), detailing sales contributions, cover counts, and site-level variances.
- Paragraph 4 (Product Mix & SPH Trends): Mine category trends across Food, Drinks, Wine, and Spend Per Head (SPH) averages, highlighting top-performing categories and declining volume areas.
- Paragraph 5 (Labor Overhead & Margin Efficiency): Analyze staff cost stickiness, static headcount overhang vs zero revenue during closures, and labor-to-revenue percentage ratios.

Return a SINGLE CONSOLIDATED JSON OBJECT matching this exact structure:

{
  "title": "Executive AI Commentary",
  "ai_commentary": {
    "overview": "Extensive, highly-detailed multi-paragraph executive analysis (400-600 words across 4-5 paragraphs). Synthesize all data points, exact currency figures (£), percentage changes (YoY & WoW), operational trading blackouts, site breakdowns, category trends, and labor efficiency into one comprehensive description.",
    "status": "Critical | Warning | Positive | Neutral",
    "status_color": "red | yellow | green | blue",
    "key_findings": [
      "Extensive data-mined insight 1 with exact figures, dates/weeks, and percentage variances",
      "Extensive data-mined insight 2 with exact figures, dates/weeks, and percentage variances",
      "Extensive data-mined insight 3 with exact figures, dates/weeks, and percentage variances",
      "Extensive data-mined insight 4 with exact figures, dates/weeks, and percentage variances",
      "Extensive data-mined insight 5 with exact figures, dates/weeks, and percentage variances"
    ],
    "recommendations": [
      "Strategic actionable recommendation 1 based on mined data",
      "Strategic actionable recommendation 2 based on mined data",
      "Strategic actionable recommendation 3 based on mined data",
      "Strategic actionable recommendation 4 based on mined data"
    ]
  }
}

STRICT CONSTRAINTS:
1. "overview": MUST BE VERY LONG AND EXHAUSTIVE (400-600 words / 4-5 detailed paragraphs). Do NOT make it brief or concise!
2. DO NOT INCLUDE ANY "sections" ARRAY.
3. "key_findings": Provide 5 to 7 detailed, high-impact findings with exact figures mined directly from the input JSON objects.
4. "recommendations": Provide 4 to 5 concrete, actionable operational strategies.
`;

  console.log("PAYLOAD SENT TO GEMINI AI ====================", JSON.stringify(dataBatch, null, 2));
  // logger.info("PAYLOAD SENT TO GEMINI AI ====================", JSON.stringify(dataBatch, null, 2));
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
    contents: contentText,
    config: {
      responseMimeType: "application/json",
    },
  });


  const usageMetadata = {
    prompt_tokens: response.usageMetadata?.promptTokenCount || 0,
    candidates_tokens: response.usageMetadata?.candidatesTokenCount || 0,
    total_tokens: response.usageMetadata?.totalTokenCount || 0,
  };

  try {
    console.log('response.text==>', response.text);

    const parsed = JSON.parse(response.text);
    return { result: parsed, usageMetadata };
  } catch (parseError) {
    return { result: { rawResponse: response.text }, usageMetadata };
  }
};

export const generateResponse = async ({ prompt, data }) => {
  const sanitizedData = sanitizeComponentData(data);

  if (Array.isArray(sanitizedData) && sanitizedData.length > 20) {
    logger.info(`Large payload detected (${sanitizedData.length} components). Batching into parallel chunks of 20 components...`);
    const chunkSize = 20;
    const batches = [];

    for (let i = 0; i < sanitizedData.length; i += chunkSize) {
      batches.push(sanitizedData.slice(i, i + chunkSize));
    }

    const batchResults = await Promise.all(
      batches.map(dataBatch => processSingleBatch({ prompt, dataBatch }))
    );

    const mergedResult = [];
    const aggregatedUsage = { prompt_tokens: 0, candidates_tokens: 0, total_tokens: 0 };

    for (const batchRes of batchResults) {
      if (Array.isArray(batchRes.result)) {
        mergedResult.push(...batchRes.result);
      } else {
        mergedResult.push(batchRes.result);
      }

      aggregatedUsage.prompt_tokens += batchRes.usageMetadata.prompt_tokens;
      aggregatedUsage.candidates_tokens += batchRes.usageMetadata.candidates_tokens;
      aggregatedUsage.total_tokens += batchRes.usageMetadata.total_tokens;
    }

    logger.info(`Successfully processed ${sanitizedData.length} components across ${batches.length} parallel batches.`);
    return { result: mergedResult, usageMetadata: aggregatedUsage };
  }

  return processSingleBatch({ prompt, dataBatch: sanitizedData });
};