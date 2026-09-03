# 🤖 AI Commentary — Multi-Provider Business Intelligence API (Gemini, OpenAI, Claude)

A lightweight, high-performance Node.js/Express REST API that generates rich, data-driven executive commentary and component-level insights from hospitality, hotel, restaurant, and sales analytics data using **Google Gemini**, **OpenAI**, or **Anthropic Claude**.

---

## ✨ Features

- 🧠 **Multi-Provider AI Support** — Switch dynamically between **Gemini (1)**, **OpenAI (2)**, and **Claude (3)** using flags in headers, queries, or body
- 📈 **Executive AI Commentary** — Multi-paragraph (400–600 word) analytical overviews synthesizing all data components
- 📊 **Component Insight Engine** — Per-component AI analysis with status, key findings, metrics summary, and recommendations
- ⚡ **Parallel Batch Processing** — Automatically splits large payloads (>20 components) into parallel AI calls and merges results
- 🧹 **Smart Data Sanitization** — Strips null, zero, and empty values before sending to LLMs to drastically reduce token usage
- 📝 **Structured Winston Logging** — File-based (`app.log`, `error.log`) and console logging with environment-aware levels
- 📦 **Token Usage & Provider Tracking** — Every response includes prompt, candidate/completion, and total token counts along with active provider and model

---

## 🚦 AI Provider Selection Flags

You can specify which AI model to use on every request using a **flag** or **provider name**:

| Flag Number | Provider Name | Default Model | Environment Variable |
|---|---|---|---|
| `1` | `gemini` / `google` | `gemini-2.0-flash` | `GEMINI_API_KEY`, `GEMINI_MODEL` |
| `2` | `openai` / `chatgpt` | `gpt-4o` | `OPENAI_API_KEY`, `OPENAI_MODEL` |
| `3` | `claude` / `anthropic` | `claude-3-5-sonnet-20241022` | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` |

### How to Pass the Flag:

1. **Via Query Parameter**:
   `POST /api/ai/chat?flag=2` or `POST /api/ai/chat?provider=openai`
2. **Via Request Header**:
   `x-ai-provider: 2` or `provider: openai` or `flag: 1`
3. **Via Request Body**:
   `{ "flag": 2, "data": [ ... ] }` or `{ "provider": "claude", "prompt": "..." }`
4. **Via `.env` Default**:
   `DEFAULT_AI_PROVIDER=openai` (or `DEFAULT_AI_PROVIDER=2`)

---

## 🏗️ Project Structure

```
AI-Commentary/
├── app.js                  # Express app setup & middleware
├── server.js               # Server entry point (port binding)
├── config/
│   ├── aiProviders.js      # Provider resolution (1: Gemini, 2: OpenAI, 3: Claude)
│   ├── gemini.js           # Google Gemini AI client initialization
│   ├── openai.js           # OpenAI client initialization
│   ├── claude.js           # Anthropic Claude client initialization
│   └── logger.js           # Winston logger configuration
├── controllers/
│   └── aiController.js     # Route handlers with provider flag extraction
├── routes/
│   └── aiRoutes.js         # API route definitions
├── services/
│   ├── aiService.js        # Core multi-provider AI logic: sanitization, prompting, batching
│   └── geminiServices.js   # Re-exports aiService for backward compatibility
├── logs/                   # Runtime log files (git-ignored)
│   ├── app.log
│   └── error.log
├── .env                    # Environment variables (git-ignored)
├── .env.example
├── .gitignore
└── package.json
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- API Keys for one or more providers:
  - [Google Gemini API Key](https://aistudio.google.com/app/apikey)
  - [OpenAI API Key](https://platform.openai.com/api-keys)
  - [Anthropic Claude API Key](https://console.anthropic.com/settings/keys)

### Installation

```bash
# Clone the repository
git clone https://github.com/rishbhbhawsar1996/AI-Commetary.git
cd AI-Commetary

# Install dependencies
npm install
```

### Environment Setup

Create or update `.env` in the project root:

```env
PORT=3000
LOG_LEVEL=info
NODE_ENV=development

# Default AI Provider if not specified in request: 1 (gemini), 2 (openai), 3 (claude)
DEFAULT_AI_PROVIDER=gemini

# 1. Google Gemini Configuration
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.0-flash

# 2. OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4o

# 3. Anthropic Claude Configuration
ANTHROPIC_API_KEY=your_anthropic_api_key_here
CLAUDE_MODEL=claude-3-5-sonnet-20241022
```

### Running the Server

```bash
# Development (with auto-restart via nodemon)
npm run dev

# Production
node server.js
```

---

## 📡 API Reference

### Base URL

```
http://localhost:3000/api/ai
```

---

### `POST /api/ai/chat`

Generates an **Executive AI Commentary** adhering to the 18 AI Insight Generation Rules by analyzing one or more data components. Supports large payloads (>20 components) with parallel batching.

#### Request Headers / Query Params

| Parameter | Type | In | Description |
|---|---|---|---|
| `flag` / `provider` | `string \| number` | Query / Header / Body | `1` (Gemini), `2` (OpenAI), `3` (Claude) |
| `prompt` | `string` | Query / Header / Body | Custom analysis instruction |

#### Request Example (OpenAI Flag `2`):

```http
POST /api/ai/chat?flag=2&prompt=Focus+on+profitability+trends
Content-Type: application/json

[
  {
    "COMPONENT_TYPE_ID": 101,
    "TITLE": "YTD Sales Summary",
    "CHART_OUTPUT_LIST": [ ... ]
  },
  {
    "COMPONENT_TYPE_ID": 102,
    "TITLE": "Staff Cost Overview",
    "CHART_OUTPUT_LIST": [ ... ]
  }
]
```

#### Response

```json
{
  "success": true,
  "provider": "openai",
  "model": "gpt-4o",
  "data": {
    "title": "Executive AI Commentary",
    "ai_commentary": {
      "overview": "Overall restaurant performance remained solid this week with total sales reaching £48,500. Drinks sales represented the strongest positive, growing by 12.4% driven by higher cocktail velocity during evening sessions. Conversely, weekday lunch covers dropped by 8.1%, presenting the biggest concern for table utilisation. Focus on weekday lunch promotions to rebuild covers while maintaining evening beverage momentum.",
      "status": "Warning",
      "status_color": "yellow",
      "key_findings": [
        "Evening drinks sales surged to £18,200 (+12.4%), boosting total wet revenue significantly.",
        "Weekday lunch covers declined by 8.1% to 320 guests, dampening midday food turnover.",
        "Average spend per guest increased by £2.10 to £34.50, partially offsetting the lower covers.",
        "Dessert attachment rate fell to 14.2% (-6.0%), reducing potential incremental revenue per table."
      ],
      "recommendations": [
        "Introduce a targeted two-course express lunch menu priced at £18.50 to recover weekday midday covers.",
        "Train front-of-house staff on pairing dessert wines and after-dinner coffees to lift dessert attachment rate.",
        "Extend the weekend signature cocktail feature into Thursday evening sessions to capitalize on beverage demand."
      ]
    }
  },
  "token_usage": {
    "prompt_tokens": 1200,
    "candidates_tokens": 320,
    "total_tokens": 1520
  }
}
```

---

### `POST /api/ai/component-insight`

Generates a **detailed per-component insight** including status, key findings, metrics summary, highlights, recommendations, and an AI commentary block.

#### Request Example (Claude Flag `3` in Body):

```http
POST /api/ai/component-insight
Content-Type: application/json

{
  "flag": 3,
  "COMPONENT_TYPE_ID": 205,
  "TITLE": "Food & Beverage Product Mix",
  "CHART_OUTPUT_LIST": [ ... ]
}
```

#### Response

```json
{
  "success": true,
  "provider": "claude",
  "model": "claude-3-5-sonnet-20241022",
  "data": {
    "COMPONENT_TYPE_ID": 205,
    "TITLE": "Food & Beverage Product Mix",
    "IS_LOAD_MORE": false,
    "PAGE_NUMBER": 1,
    "AI_INSIGHT": {
      "summary": "Food revenue is trending 12% above budget driven by weekend covers...",
      "status": "Positive",
      "status_color": "green",
      "key_findings": ["Food SPH increased to £28.4 vs £25.1 budget..."],
      "top_highlights": ["Weekend F&B outperforms weekdays by 34%"],
      "metrics_summary": {
        "total_value": "£380,420",
        "variance_vs_budget": "+12.3%",
        "variance_vs_last_year": "+5.8%"
      },
      "recommendations": ["Extend weekend F&B promotions to Thursday evenings..."],
      "AI_COMMENTARY": {
        "overview": "Comprehensive executive commentary...",
        "sections": [
          {
            "title": "FOOD SALES",
            "trend": "up",
            "commentary": "Food revenue exceeded budget by..."
          }
        ]
      }
    }
  },
  "token_usage": {
    "prompt_tokens": 1800,
    "candidates_tokens": 420,
    "total_tokens": 2220
  }
}
```

---

## 🔧 Architecture & Key Design Decisions

### Data Sanitization
Before any data is sent to the LLM, it passes through a recursive `sanitizeComponentData()` function that removes:
- `null`, `undefined`, `false`, `""` values
- Zero-value metrics (`0`, `0.0`, `"0%"`, etc.) — except essential identifier keys like `COMPONENT_TYPE_ID`
- Empty arrays and empty objects
- Series arrays containing only zeros or nulls

### Parallel Batching
When a payload contains more than **20 components**, `generateResponse()` automatically:
1. Splits the array into chunks of 20
2. Executes batches concurrently across the chosen provider
3. Merges results and aggregates token usage

---

## 📦 Dependencies

| Package | Purpose |
|---|---|
| `express` | Web framework |
| `@google/genai` | Google Gemini AI SDK (Provider 1) |
| `openai` | OpenAI SDK (Provider 2) |
| `@anthropic-ai/sdk` | Anthropic Claude SDK (Provider 3) |
| `dotenv` | Environment variable management |
| `winston` | Structured logging |
| `nodemon` | Dev auto-restart |

---

## 📄 License

ISC
