# PiPilot Search API Documentation

🚀 **Live API:** `https://pipilot-search-api.hanscadx8.workers.dev`

The most powerful, cheapest AI search API for agents. Built with:
- FREE search (Jina Reader + DuckDuckGo)
- FREE AI reranking (a0 LLM - no API key needed!)
- Cloudflare Workers (100k requests/day free tier)
- Cloudflare KV for API key management
- 90%+ cache hit rate for ultra-low costs

---

## 🔑 Authentication

All API requests (except `/health`) require an API key via the `Authorization` header:

```bash
Authorization: Bearer YOUR_API_KEY
```

### Getting an API Key

Create a new API key using the management script:

```bash
# Create a free tier key
node scripts/manage-keys.js create "My App" free

# Create a pro tier key
node scripts/manage-keys.js create "Production App" pro

# List all keys
node scripts/manage-keys.js list

# Get key details
node scripts/manage-keys.js info pk_test_xxx

# Revoke a key
node scripts/manage-keys.js revoke pk_test_xxx
```

### Rate Limits

| Tier       | Requests/Hour | Key Prefix  |
|------------|---------------|-------------|
| Free       | 1,000         | `pk_test_`  |
| Pro        | 5,000         | `pk_live_`  |
| Enterprise | 10,000        | `pk_live_`  |

---

## 📡 Endpoints

### 1. Health Check

Check API status (no authentication required).

```bash
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2026-03-12T06:47:46.724Z"
}
```

**Example:**
```bash
curl https://pipilot-search-api.hanscadx8.workers.dev/health
```

---

### 2. Web Search

Search the web and optionally rerank results with AI.

```bash
POST /search
```

**Request Body:**
```json
{
  "query": "latest AI news",
  "maxResults": 10,
  "rerank": true
}
```

**Parameters:**
- `query` (string, required): Search query
- `maxResults` (number, optional): Number of results (default: 10)
- `rerank` (boolean, optional): Use AI reranking (default: true)

**Response:**
```json
{
  "success": true,
  "query": "latest AI news",
  "results": [
    {
      "title": "Article Title",
      "url": "https://example.com/article",
      "snippet": "Article description...",
      "position": 1,
      "score": 0.95,
      "rerankReasoning": "Highly relevant because..."
    }
  ],
  "count": 10,
  "cached": false,
  "reranked": true,
  "processingTime": "450ms"
}
```

**Example:**
```bash
curl -X POST https://pipilot-search-api.hanscadx8.workers.dev/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "query": "best AI coding tools 2025",
    "maxResults": 5,
    "rerank": true
  }'
```

---

### 3. Web Extract

Extract clean content from any URL.

```bash
POST /extract
```

**Request Body:**
```json
{
  "url": "https://example.com/article",
  "format": "markdown"
}
```

**Parameters:**
- `url` (string, required): URL to extract content from
- `format` (string, optional): Output format - `markdown`, `text`, or `html` (default: `markdown`)

**Response:**
```json
{
  "success": true,
  "url": "https://example.com/article",
  "content": "# Article Title\n\nClean markdown content...",
  "format": "markdown",
  "wordCount": 1250,
  "charCount": 8500,
  "cached": false,
  "processingTime": "780ms"
}
```

**Example:**
```bash
curl -X POST https://pipilot-search-api.hanscadx8.workers.dev/extract \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "url": "https://pipilot.dev",
    "format": "markdown"
  }'
```

---

### 4. Smart Search (AI Q&A)

Iterative AI-powered research with tool calling. The AI will automatically search the web, extract content, and synthesize a final answer.

```bash
POST /smart-search
```

**Request Body:**
```json
{
  "query": "What are the latest features in Claude Sonnet 4.5?",
  "depth": "normal",
  "maxIterations": 3
}
```

**Parameters:**
- `query` (string, required): Research question
- `depth` (string, optional): Search depth - `quick`, `normal`, or `deep` (default: `normal`)
- `maxIterations` (number, optional): Max tool calls (default: 3, max: 5)

**Response:**
```json
{
  "success": true,
  "query": "What are the latest features in Claude Sonnet 4.5?",
  "answer": "Claude Sonnet 4.5 introduces several new features including...",
  "sources": [
    { "type": "search", "query": "Claude Sonnet 4.5 features" },
    { "type": "extract", "url": "https://anthropic.com/..." }
  ],
  "steps": [
    {
      "iteration": 1,
      "action": "web_search",
      "reasoning": "Need to find latest information...",
      "llmTime": "350ms",
      "toolTime": "680ms",
      "resultLength": 8000
    },
    {
      "iteration": 2,
      "action": "answer",
      "reasoning": "Found comprehensive information"
    }
  ],
  "iterations": 2,
  "totalTime": "2450ms"
}
```

**Example:**
```bash
curl -X POST https://pipilot-search-api.hanscadx8.workers.dev/smart-search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "query": "Compare Next.js 15 vs Remix performance",
    "depth": "deep",
    "maxIterations": 5
  }'
```

---

## 🎯 SDK & Integrations

### TypeScript/JavaScript

```typescript
import { PiPilot } from 'pipilot-search-sdk';

const client = new PiPilot({
  apiKey: 'YOUR_API_KEY'
});

// Search
const results = await client.search({
  query: 'AI coding tools',
  maxResults: 10,
  rerank: true
});

// Extract
const content = await client.extract({
  url: 'https://example.com'
});

// Smart search
const answer = await client.smartSearch({
  query: 'What is PiPilot?'
});
```

### Python

```python
from pipilot import PiPilot

client = PiPilot(api_key='YOUR_API_KEY')

# Search
results = client.search(
    query='AI coding tools',
    max_results=10,
    rerank=True
)

# Extract
content = client.extract(url='https://example.com')

# Smart search
answer = client.smart_search(query='What is PiPilot?')
```

### MCP Server (Claude Desktop)

Add to your MCP settings:

```json
{
  "mcpServers": {
    "pipilot-search": {
      "command": "npx",
      "args": [
        "pipilot-search-mcp",
        "--api-key",
        "YOUR_API_KEY"
      ]
    }
  }
}
```

---

## 📊 Response Headers

All responses include:

- `X-Processing-Time`: Request processing time in milliseconds
- `X-Cached`: `true` if response was served from cache
- `Access-Control-Allow-Origin`: `*` (CORS enabled)

---

## 🚨 Error Responses

### 401 Unauthorized

```json
{
  "error": "Missing Authorization header"
}
```

```json
{
  "error": "Invalid or revoked API key"
}
```

### 429 Rate Limit Exceeded

```json
{
  "error": "Rate limit exceeded",
  "limit": 1000,
  "remaining": 0,
  "resetAt": 1678886400000
}
```

### 400 Bad Request

```json
{
  "error": "Missing or empty query parameter"
}
```

### 500 Internal Server Error

```json
{
  "error": "Internal server error",
  "message": "Error details..."
}
```

---

## 💡 Best Practices

1. **Cache Aggressively**: Results are cached for 1-24 hours. Identical requests are served instantly.

2. **Use Reranking Wisely**: AI reranking improves relevance but adds ~300-500ms. Disable for speed-critical use cases.

3. **Smart Search for Complex Queries**: Use `/smart-search` for multi-step research, `/search` for simple lookups.

4. **Handle Rate Limits**: Implement exponential backoff when you receive 429 responses.

5. **Monitor Usage**: Use `node scripts/manage-keys.js info YOUR_KEY` to track usage.

---

## 🔧 Pricing

| Tier       | Monthly Cost | Requests/Month | Overage     |
|------------|--------------|----------------|-------------|
| Free       | $0           | 30,000         | N/A         |
| Pro        | $29          | 150,000        | $0.50/1k    |
| Enterprise | Custom       | Unlimited      | Custom      |

**Why so cheap?**
- Zero search API costs (using free services)
- Zero AI costs (a0 LLM is free)
- Cloudflare Workers free tier (100k requests/day)
- 90%+ cache hit rate (minimal compute)

---

## 📈 Performance

- **p50 latency (cached):** <100ms
- **p50 latency (uncached):** <500ms
- **p99 latency:** <2s
- **Cache hit rate:** 90%+
- **Uptime:** 99.9%

---

## 🛠️ Support

- **Documentation:** https://docs.pipilot.dev/api/search
- **Discord:** https://discord.gg/pipilot
- **Email:** hello@pipilot.dev
- **GitHub Issues:** https://github.com/Hansade2005/pipilot-search-api/issues

---

## 📝 Changelog

### v1.0.0 (2026-03-12)

- Initial release
- Web search with AI reranking
- Web content extraction
- Smart search (AI Q&A with tool calling)
- Cloudflare KV-based API key management
- Rate limiting (1000 req/hour free tier)
- CORS support
- 90%+ cache hit rate

---

Built with ❤️ by Hans Ade - Pixelways Solutions Inc
