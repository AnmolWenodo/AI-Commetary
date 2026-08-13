# 🤖 AI Commentary — Gemini-Powered Business Intelligence API

A lightweight Node.js/Express REST API that leverages **Google Gemini AI** to generate rich, data-driven executive commentary and component-level insights from hospitality, hotel, restaurant, and sales analytics data.

---

## ✨ Features

- 🧠 **Executive AI Commentary** — Multi-paragraph (400–600 word) analytical overviews synthesizing all data components
- 📊 **Component Insight Engine** — Per-component AI analysis with status, key findings, metrics summary, and recommendations
- ⚡ **Parallel Batch Processing** — Automatically splits large payloads (>20 components) into parallel Gemini API calls and merges results
- 🧹 **Smart Data Sanitization** — Strips null, zero, and empty values before sending to Gemini to drastically reduce token usage
- 📝 **Structured Winston Logging** — File-based (`app.log`, `error.log`) and console logging with environment-aware levels
- 📦 **Token Usage Tracking** — Every response includes prompt, candidate, and total token counts

---

## 🏗️ Project Structure

```
AI-Commentary/
├── app.js                  # Express app setup & middleware
├── server.js               # Server entry point (port binding)
├── config/
│   ├── gemini.js           # Google Gemini AI client initialization
│   └── logger.js           # Winston logger configuration
├── controllers/
│   └── aiController.js     # Route handler logic (chat & component insight)
├── routes/
│   └── aiRoutes.js         # API route definitions
├── services/
│   └── geminiServices.js   # Core AI logic: sanitization, prompting, batching
├── logs/                   # Runtime log files (git-ignored)
│   ├── app.log
│   └── error.log
├── .env                    # Environment variables (git-ignored)
├── .gitignore
└── package.json
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- A [Google Gemini API Key](https://aistudio.google.com/app/apikey)

### Installation

```bash
# Clone the repository
git clone https://github.com/rishbhbhawsar1996/AI-Commetary.git
cd AI-Commetary

# Install dependencies
npm install
```

### Environment Setup

Create a `.env` file in the project root:

```env
PORT=3000
GEMINI_API_KEY=your_google_gemini_api_key_here
GEMINI_MODEL=gemini-2.0-flash
LOG_LEVEL=info
NODE_ENV=development
```

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | Server port |
| `GEMINI_API_KEY` | ✅ Yes | — | Your Google Gemini API key |
| `GEMINI_MODEL` | No | `gemini-2.0-flash` | Gemini model to use |
| `LOG_LEVEL` | No | `info` | Winston log level |
| `NODE_ENV` | No | — | Set to `production` to disable console logs |

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

Generates an **Executive AI Commentary** by analyzing one or more data components.

Supports large payloads — components are automatically batched in parallel chunks of 20.

#### Request

| Source | Field | Type | Description |
|---|---|---|---|
| Query / Header | `prompt` | `string` | Custom analysis instruction |
| Body | — | `Array<Object>` | Array of component data objects |
| Body | `prompt` | `string` | (Optional) Inline prompt |
| Body | `data` | `Array<Object>` | (Optional) Component data |

#### Request Example

```http
POST /api/ai/chat?prompt=Focus+on+profitability+trends
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
  "data": {
    "title": "Executive AI Commentary",
    "ai_commentary": {
      "overview": "Extensive multi-paragraph executive analysis...",
      "status": "Warning",
      "status_color": "yellow",
      "key_findings": [
        "YTD Sales reached £1.2M, down 8% YoY due to Week 23–29 trading blackout...",
        "..."
      ],
      "recommendations": [
        "Accelerate post-reopening marketing to recover lost covers in Q3...",
        "..."
      ]
    }
  },
  "token_usage": {
    "prompt_tokens": 4200,
    "candidates_tokens": 850,
    "total_tokens": 5050
  }
}
```

---

### `POST /api/ai/component-insight`

Generates a **detailed per-component insight** including status, key findings, metrics summary, highlights, recommendations, and an AI commentary block.

- **Single object** → generates a focused single-component insight
- **Array with 1 item** → unwrapped and treated as a single component
- **Array with >1 items** → routed to the batch commentary engine (same as `/chat`)

#### Request Example

```http
POST /api/ai/component-insight
Content-Type: application/json

{
  "COMPONENT_TYPE_ID": 205,
  "TITLE": "Food & Beverage Product Mix",
  "CHART_OUTPUT_LIST": [ ... ]
}
```

#### Response

```json
{
  "success": true,
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
Before any data is sent to Gemini, it passes through a recursive `sanitizeComponentData()` function that removes:
- `null`, `undefined`, `false`, `""` values
- Zero-value metrics (`0`, `0.0`, `"0%"`, etc.) — except essential identifier keys like `COMPONENT_TYPE_ID`
- Empty arrays and empty objects
- Series arrays containing only zeros or nulls

This significantly reduces token consumption on large dashboard payloads.

### Parallel Batching
When a payload contains more than **20 components**, `generateResponse()` automatically:
1. Splits the array into chunks of 20
2. Fires all batches concurrently via `Promise.all()`
3. Merges results and aggregates token usage

### Flexible Body Parsing
The Express app accepts raw JSON strings, JSON arrays, and newline-delimited JSON objects — parsing them all into a unified `req.body` structure before reaching the controllers.

---

## 📦 Dependencies

| Package | Purpose |
|---|---|
| `express` | Web framework |
| `@google/genai` | Google Gemini AI SDK |
| `dotenv` | Environment variable management |
| `winston` | Structured logging |
| `nodemon` | Dev auto-restart |

---

## 📄 License

ISC
