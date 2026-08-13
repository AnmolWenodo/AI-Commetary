import { generateResponse, generateSingleComponentInsight } from "../services/geminiServices.js";

export const chat = async (req, res) => {
  try {
    let prompt = req.query?.prompt || req.headers?.prompt;
    let data;

    if (Array.isArray(req.body)) {
      data = req.body;
    } else if (req.body && typeof req.body === "object") {
      if (req.body.data !== undefined || req.body.prompt !== undefined) {
        prompt = req.body.prompt || prompt;
        data = req.body.data;
      } else {
        data = req.body;
      }
    }

    if (!prompt && (!data || (typeof data === "object" && Object.keys(data).length === 0))) {
      return res.status(400).json({
        success: false,
        message: "Prompt or JSON data payload is required",
      });
    }

    console.log("Extracted Prompt ==>", prompt || "(Using default prompt instruction)");
    console.log("Extracted Data Components Count ==>", Array.isArray(data) ? data.length : 1);

    const response = await generateResponse({ prompt, data });

    res.json({
      success: true,
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
 * Controller to handle single component insight request
 */
export const getComponentInsight = async (req, res) => {
  try {
    let componentData = req.body;

    // const customPrompt = req.query?.prompt || req.headers?.prompt || (typeof req.body === "object" && !Array.isArray(req.body) ? req.body?.prompt : undefined);
    const customPrompt = "You are an expert AI Business Analyst specializing in Hospitality, Hotel Operations, Restaurant Management, and Sales Analytics.";

    if (!componentData || (typeof componentData === "object" && Object.keys(componentData).length === 0)) {
      return res.status(400).json({
        success: false,
        message: "Component data object or array payload is required in request body",
      });
    }

    if (Array.isArray(componentData)) {
      if (componentData.length === 1) {
        componentData = componentData[0];
      } else if (componentData.length > 1) {
        console.log("Multi-component array sent to /component-insight. Total components:", componentData.length);
        const response = await generateResponse({ prompt: customPrompt, data: componentData });
        return res.json({
          success: true,
          data: response.result,
          token_usage: response.usageMetadata,
        });
      }
    }

    console.log("Single Component Request for ID:", componentData.COMPONENT_TYPE_ID || componentData.COMPONENT_ID);

    const response = await generateSingleComponentInsight({
      componentData,
      customPrompt
    });

    res.json({
      success: true,
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




