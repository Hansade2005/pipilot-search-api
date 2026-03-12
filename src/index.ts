/**
 * PiPilot Search API - Cloudflare Worker
 *
 * The most powerful, cheapest AI search API for agents
 * Built by Hans Ade - Pixelways Solutions Inc
 *
 * Features:
 * - FREE search using Jina Reader + DuckDuckGo
 * - FREE AI reranking using a0 LLM (no API key needed!)
 * - Smart Q&A endpoint with iterative tool calling
 * - 90%+ cache hit rate = ultra-low costs
 * - <250ms p50 latency (cached), <500ms (uncached)
 */

interface Env {
  CACHE: KVNamespace;
  API_KEYS: KVNamespace;
  ENVIRONMENT: string;
  VERSION: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const JINA_READER_URL = "https://r.jina.ai";
const DUCKDUCKGO_HTML = "https://html.duckduckgo.com/html";
const A0_LLM_URL = "https://api.a0.dev/ai/llm";

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const MAX_SMART_SEARCH_ITERATIONS = 30;

// Global rate limiting (Cloudflare free tier limits)
const DAILY_REQUEST_LIMIT = 95000; // 95k of 100k to leave buffer
const QUOTA_WARNING_THRESHOLD = 0.8; // 80% = start serving cache-only
const QUOTA_CRITICAL_THRESHOLD = 0.95; // 95% = queue requests

// ─── Types ──────────────────────────────────────────────────────────────────

interface SearchRequest {
  query: string;
  maxResults?: number;
  rerank?: boolean;
  region?: string;
}

interface ExtractRequest {
  url: string;
  format?: 'markdown' | 'text' | 'html';
}

interface SmartSearchRequest {
  query: string;
  depth?: 'quick' | 'normal' | 'deep';
  maxIterations?: number;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  position: number;
  score?: number;
  rerankReasoning?: string;
}

// ─── Main Worker ────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const start = Date.now();

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Health check (no auth required)
    if (url.pathname === '/health') {
      const quota = await getGlobalQuotaStatus(env);
      return jsonResponse({
        status: 'ok',
        version: env.VERSION || '1.0.0',
        timestamp: new Date().toISOString(),
        quota: {
          used: quota.used,
          limit: quota.limit,
          remaining: quota.remaining,
          percentage: quota.percentage,
          resetsAt: quota.resetsAt
        }
      });
    }

    // Global quota check (BEFORE auth to prevent quota exhaustion)
    const quota = await checkGlobalQuota(env);

    if (quota.status === 'exhausted') {
      return jsonResponse({
        error: 'Service quota exhausted',
        message: 'Daily API quota reached. Service will resume tomorrow.',
        quota: {
          used: quota.used,
          limit: quota.limit,
          resetsAt: quota.resetsAt
        },
        retryAfter: Math.ceil((quota.resetsAt - Date.now()) / 1000)
      }, 503);
    }

    // Auth check
    const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!apiKey) {
      return jsonResponse({ error: 'Missing Authorization header' }, 401);
    }

    // Validate API key with Cloudflare KV
    const keyData = await env.API_KEYS.get(apiKey, 'json');
    if (!keyData || keyData.revoked) {
      return jsonResponse({ error: 'Invalid or revoked API key' }, 401);
    }

    // Rate limiting check
    const rateLimit = await checkRateLimit(apiKey, env);
    if (!rateLimit.allowed) {
      return jsonResponse({
        error: 'Rate limit exceeded',
        limit: rateLimit.limit,
        remaining: rateLimit.remaining,
        resetAt: rateLimit.resetAt
      }, 429);
    }

    // Route handling
    try {
      let response: Response;

      // Pass quota status to handlers for cache-only mode
      const cacheOnlyMode = quota.status === 'warning' || quota.status === 'critical';

      switch (url.pathname) {
        case '/search':
          response = await handleSearch(request, env, cacheOnlyMode);
          break;

        case '/extract':
          response = await handleExtract(request, env, cacheOnlyMode);
          break;

        case '/smart-search':
          response = await handleSmartSearch(request, env, cacheOnlyMode);
          break;

        case '/':
          response = jsonResponse({
            name: 'PiPilot Search API',
            version: env.VERSION || '1.0.0',
            endpoints: {
              'POST /search': 'Search the web',
              'POST /extract': 'Extract content from URL',
              'POST /smart-search': 'Iterative Q&A with AI',
              'GET /health': 'Health check'
            },
            docs: 'https://docs.pipilot.dev/api/search'
          });
          break;

        default:
          response = jsonResponse({ error: 'Not found' }, 404);
      }

      // Add processing time header
      const processingTime = Date.now() - start;
      response.headers.set('X-Processing-Time', `${processingTime}ms`);

      // Add quota headers
      response.headers.set('X-Quota-Used', quota.used.toString());
      response.headers.set('X-Quota-Remaining', quota.remaining.toString());
      response.headers.set('X-Quota-Limit', quota.limit.toString());

      if (cacheOnlyMode) {
        response.headers.set('X-Cache-Only-Mode', 'true');
        response.headers.set('X-Quota-Warning', 'Approaching daily limit - serving cached results only');
      }

      // Increment counters in KV (async, don't block response)
      ctx.waitUntil(Promise.all([
        incrementUsageCounter(apiKey, env),
        incrementGlobalQuota(env, response.headers.get('X-Cached') === 'true')
      ]));

      return response;

    } catch (err: any) {
      console.error('[ERROR]', err);
      return jsonResponse({
        error: 'Internal server error',
        message: err.message,
        stack: env.ENVIRONMENT === 'development' ? err.stack : undefined
      }, 500);
    }
  }
};

// ─── Handler: Search ────────────────────────────────────────────────────────

async function handleSearch(request: Request, env: Env, cacheOnlyMode = false): Promise<Response> {
  const start = Date.now();
  const body = await request.json() as SearchRequest;
  const { query, maxResults = 10, rerank = true } = body;

  if (!query || query.trim() === '') {
    return jsonResponse({ error: 'Missing or empty query parameter' }, 400);
  }

  console.log(`[SEARCH] Query: "${query}", maxResults: ${maxResults}, rerank: ${rerank}, cacheOnly: ${cacheOnlyMode}`);

  // Check cache
  const cacheKey = `search:${query}:${maxResults}:${rerank}`;
  const cached = await env.CACHE.get(cacheKey, 'json');
  if (cached) {
    console.log(`[SEARCH] Cache HIT for "${query}"`);
    const response = jsonResponse({
      ...cached,
      cached: true,
      processingTime: `${Date.now() - start}ms`
    });
    response.headers.set('X-Cached', 'true');
    return response;
  }

  // If cache-only mode and no cache, return error
  if (cacheOnlyMode) {
    return jsonResponse({
      error: 'Cache miss in quota-limited mode',
      message: 'Daily quota approaching limit. Only cached results are available. Try again later or use a different query.',
      query,
      suggestion: 'Try a more common search query that may be cached'
    }, 503);
  }

  console.log(`[SEARCH] Cache MISS for "${query}" - fetching...`);

  // Execute search
  const rawResults = await executeWebSearch(query);

  // Parse results
  let results = parseSearchResults(rawResults, maxResults);

  console.log(`[SEARCH] Parsed ${results.length} results`);

  // Rerank with a0 LLM if requested
  if (rerank && results.length > 1) {
    console.log(`[SEARCH] Reranking with a0 LLM...`);
    const rerankStart = Date.now();
    results = await rerankResults(query, results);
    console.log(`[SEARCH] Reranked in ${Date.now() - rerankStart}ms`);
  }

  const response = {
    success: true,
    query,
    results,
    count: results.length,
    cached: false,
    reranked: rerank,
    processingTime: `${Date.now() - start}ms`
  };

  // Cache for 1 hour
  await env.CACHE.put(cacheKey, JSON.stringify(response), { expirationTtl: 3600 });
  console.log(`[SEARCH] Cached result for "${query}"`);

  return jsonResponse(response);
}

// ─── Handler: Extract ───────────────────────────────────────────────────────

async function handleExtract(request: Request, env: Env, cacheOnlyMode = false): Promise<Response> {
  const start = Date.now();
  const body = await request.json() as ExtractRequest;
  const { url, format = 'markdown' } = body;

  if (!url || url.trim() === '') {
    return jsonResponse({ error: 'Missing or empty url parameter' }, 400);
  }

  console.log(`[EXTRACT] URL: "${url}", format: ${format}, cacheOnly: ${cacheOnlyMode}`);

  // Check cache
  const cacheKey = `extract:${url}:${format}`;
  const cached = await env.CACHE.get(cacheKey, 'json');
  if (cached) {
    console.log(`[EXTRACT] Cache HIT for "${url}"`);
    const response = jsonResponse({
      ...cached,
      cached: true,
      processingTime: `${Date.now() - start}ms`
    });
    response.headers.set('X-Cached', 'true');
    return response;
  }

  // If cache-only mode and no cache, return error
  if (cacheOnlyMode) {
    return jsonResponse({
      error: 'Cache miss in quota-limited mode',
      message: 'Daily quota approaching limit. Only cached content is available.',
      url,
      suggestion: 'Try again tomorrow when quota resets'
    }, 503);
  }

  console.log(`[EXTRACT] Cache MISS for "${url}" - fetching...`);

  // Execute extraction
  const content = await executeWebExtract(url);

  const response = {
    success: true,
    url,
    content,
    format,
    wordCount: content.split(/\s+/).length,
    charCount: content.length,
    cached: false,
    processingTime: `${Date.now() - start}ms`
  };

  // Cache for 24 hours
  await env.CACHE.put(cacheKey, JSON.stringify(response), { expirationTtl: 86400 });
  console.log(`[EXTRACT] Cached result for "${url}"`);

  return jsonResponse(response);
}

// ─── Handler: Smart Search (Iterative Q&A) ─────────────────────────────────

async function handleSmartSearch(request: Request, env: Env, cacheOnlyMode = false): Promise<Response> {
  const start = Date.now();
  const body = await request.json() as SmartSearchRequest;
  const { query, depth = 'normal', maxIterations = 3 } = body;

  if (!query || query.trim() === '') {
    return jsonResponse({ error: 'Missing or empty query parameter' }, 400);
  }

  // Smart search cannot work in cache-only mode
  if (cacheOnlyMode) {
    return jsonResponse({
      error: 'Smart search unavailable in quota-limited mode',
      message: 'Daily quota approaching limit. Smart search requires multiple API calls and is disabled.',
      query,
      suggestion: 'Use /search endpoint for cached results or try again tomorrow'
    }, 503);
  }

  const actualMaxIterations = Math.min(maxIterations || depthInfo.defaultIter, MAX_SMART_SEARCH_ITERATIONS);

  console.log(`[SMART_SEARCH] Query: "${query}", depth: ${depth}, maxIterations: ${actualMaxIterations}`);

  // Depth config: controls how aggressively the agent researches
  const depthConfig = {
    quick: { strategy: 'Answer quickly with minimal tool use. One search is usually enough.', defaultIter: 3 },
    normal: { strategy: 'Research thoroughly. Follow promising leads and extract key pages.', defaultIter: 8 },
    deep: { strategy: 'Research exhaustively. Leave no stone unturned. Follow every lead, extract multiple sources, cross-reference facts, and trace claims to their origin.', defaultIter: 15 },
  };
  const depthInfo = depthConfig[depth] || depthConfig.normal;

  // Tool system prompt - enhanced for autonomous deep research
  const toolPrompt = `You are an elite research agent. Your job is to find accurate, comprehensive answers by autonomously searching the web and reading pages. You are relentless, resourceful, and thorough.

## Tools
1. **web_search** - Search the web. Params: { "query": "search terms" }
2. **web_extract** - Extract full content from a URL. Params: { "url": "https://..." }

To call a tool, use EXACTLY this format (MUST include both opening AND closing tags):
<tool_call>{"name": "tool_name", "arguments": {"param": "value"}}</tool_call>

## Research Strategy: ${depthInfo.strategy}

## Core Behavior - CRITICAL
1. **Be proactive**: Don't just search once and give up. If initial results are vague, search again with different keywords. Rephrase, use synonyms, try related terms, add site-specific filters.
2. **Dive into pages**: When search results mention a relevant page (an about page, a blog post, a profile, documentation), USE web_extract to read it. URLs in search results are gold — extract them.
3. **Trace to the source**: If a search result references a person, company, or fact, follow the trail. Extract the actual page to get details. Don't just rely on search snippets — they're often incomplete or outdated.
4. **Use domain knowledge**: If a query mentions a website (e.g., "example.com"), proactively check common pages like /about, /team, /blog, /docs. These often have the answers.
5. **Cross-reference**: If you find a claim, try to verify it from a second source. Multiple confirming sources = higher confidence answer.
6. **Refine searches**: If your first search returns irrelevant results, don't repeat the same query. Try:
   - Adding quotes around key phrases: "exact phrase"
   - Adding the domain: site:example.com
   - Using different terminology
   - Searching for related entities
7. **Multiple tool calls per step**: You can call multiple tools in one response. If you found several promising URLs, extract them all at once.

## CRITICAL RULES
- ALWAYS use at least one tool before answering. NEVER answer from memory alone. You MUST search or extract first.
- Your FIRST response must ALWAYS contain a tool_call. No exceptions.
- Do NOT narrate what you plan to do — just DO it. Call the tools immediately.
- If a query mentions a specific website, your FIRST action should be web_extract on that site (or its /about, /team page).

## When to stop
- You have a clear, well-sourced answer with specific facts (names, dates, numbers)
- You've checked at least one primary source (not just search snippets)
- Provide your final answer directly WITHOUT any tool_call blocks

## Answer format
- Lead with the direct answer
- Include specific details (names, dates, numbers, quotes)
- Cite your sources naturally (mention where you found the info)
- If information conflicts between sources, note the discrepancy`;

  // Initialize conversation (same pattern as completions.ts)
  const a0Messages: A0Message[] = [
    { role: "system", content: toolPrompt },
    { role: "user", content: query }
  ];

  const sources: any[] = [];
  const steps: any[] = [];
  let finalContent = "";

  // Iterative tool-calling loop (same as completions.ts agent loop)
  for (let i = 0; i < actualMaxIterations; i++) {
    console.log(`[SMART_SEARCH] Step ${i + 1}/${actualMaxIterations}`);

    // Call a0 LLM (plain text, no schema)
    const llmStart = Date.now();
    const completion = await callA0LLM(a0Messages);
    const llmTime = Date.now() - llmStart;

    console.log(`[SMART_SEARCH] LLM response (${llmTime}ms): ${completion.length}ch`);

    // Parse tool calls from <tool_call> blocks
    const toolCalls = parseToolCalls(completion);
    console.log(`[SMART_SEARCH] Parsed ${toolCalls.length} tool calls: [${toolCalls.map(t => t.name).join(", ")}]`);

    // No tool calls found
    if (toolCalls.length === 0) {
      // If this is the first step and the LLM didn't use tools, force a search/extract
      // (a0 sometimes ignores tool instructions on first turn)
      if (i === 0) {
        console.log(`[SMART_SEARCH] LLM skipped tools on step 1 — forcing initial research`);

        // Check if query mentions a specific URL/domain to extract
        const urlMatch = query.match(/(?:https?:\/\/)?([a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:\/[^\s,)\]]*)?)/);
        const forcedCalls: ParsedToolCall[] = [];

        if (urlMatch) {
          const domain = urlMatch[1].replace(/[)\].,]+$/, '');
          const extractUrl = domain.startsWith('http') ? domain : `https://${domain}`;
          // Extract the mentioned site + its /about page
          forcedCalls.push({ name: 'web_extract', arguments: { url: extractUrl } });
          if (!extractUrl.includes('/about')) {
            forcedCalls.push({ name: 'web_extract', arguments: { url: `${extractUrl}/about` } });
          }
        }
        // Always do a web search too
        forcedCalls.push({ name: 'web_search', arguments: { query } });

        const forcedResults: { name: string; result: string }[] = [];
        for (const tc of forcedCalls) {
          const toolStart = Date.now();
          let result: string;
          if (tc.name === 'web_search') {
            result = await executeWebSearch(tc.arguments.query);
            sources.push({ type: 'search', query: tc.arguments.query });
          } else {
            result = await executeWebExtract(tc.arguments.url);
            sources.push({ type: 'extract', url: tc.arguments.url });
          }
          console.log(`[SMART_SEARCH] Forced ${tc.name} done (${Date.now() - toolStart}ms): ${result.length}ch`);
          forcedResults.push({ name: tc.name, result });
        }

        steps.push({
          iteration: i + 1,
          action: forcedCalls.map(t => t.name).join(', ') + ' (forced)',
          llmTime: `${llmTime}ms`
        });

        // Feed results back
        a0Messages.push({ role: "assistant", content: completion || "[Researching...]" });
        const resultsText = forcedResults
          .map(r => `[Tool Result - ${r.name}]:\n${r.result.slice(0, 6000)}`)
          .join("\n\n");
        a0Messages.push({ role: "user", content: resultsText });
        continue;
      }

      // Otherwise it's a real final answer
      finalContent = completion;
      console.log(`[SMART_SEARCH] Final answer reached in ${i + 1} steps`);

      steps.push({
        iteration: i + 1,
        action: 'answer',
        llmTime: `${llmTime}ms`
      });

      return jsonResponse({
        success: true,
        query,
        answer: finalContent,
        sources,
        steps,
        iterations: i + 1,
        totalTime: `${Date.now() - start}ms`
      });
    }

    // Execute tool calls
    const results: { name: string; result: string }[] = [];

    for (const tc of toolCalls) {
      const toolStart = Date.now();
      let result: string;

      if (tc.name === "web_search") {
        const searchQuery = tc.arguments.query || query;
        console.log(`[SMART_SEARCH] Executing web_search: "${searchQuery}"`);
        result = await executeWebSearch(searchQuery);
        sources.push({ type: 'search', query: searchQuery });
      } else if (tc.name === "web_extract") {
        const extractUrl = tc.arguments.url;
        if (!extractUrl) {
          result = "Error: No URL provided for extraction";
        } else {
          console.log(`[SMART_SEARCH] Executing web_extract: "${extractUrl}"`);
          result = await executeWebExtract(extractUrl);
          sources.push({ type: 'extract', url: extractUrl });
        }
      } else {
        result = `Unknown tool: ${tc.name}`;
      }

      const toolTime = Date.now() - toolStart;
      console.log(`[SMART_SEARCH] Tool ${tc.name} done (${toolTime}ms): ${result.length}ch`);
      results.push({ name: tc.name, result });
    }

    steps.push({
      iteration: i + 1,
      action: toolCalls.map(t => t.name).join(', '),
      llmTime: `${llmTime}ms`
    });

    // Add assistant message and tool results to conversation (same as completions.ts)
    const cleanedAssistant = stripToolCalls(completion);
    if (cleanedAssistant) {
      a0Messages.push({ role: "assistant", content: cleanedAssistant });
    } else {
      a0Messages.push({ role: "assistant", content: `[Calling tools: ${toolCalls.map(t => t.name).join(", ")}]` });
    }

    const resultsText = results
      .map(r => `[Tool Result - ${r.name}]:\n${r.result.slice(0, 6000)}`)
      .join("\n\n");
    a0Messages.push({ role: "user", content: resultsText });

    // If last step, force final response
    if (i >= actualMaxIterations - 1) {
      console.log(`[SMART_SEARCH] Max steps reached — forcing final response`);
      a0Messages.push({
        role: "user",
        content: "[System: You have reached the maximum number of tool steps. Please provide your final response now based on all the information gathered. Do NOT use any more tool_call blocks.]"
      });
      const finalCompletion = await callA0LLM(a0Messages);
      finalContent = stripToolCalls(finalCompletion);

      return jsonResponse({
        success: true,
        query,
        answer: finalContent,
        sources,
        steps,
        iterations: i + 1,
        totalTime: `${Date.now() - start}ms`
      });
    }
  }

  return jsonResponse({
    success: false,
    error: 'Max iterations reached without final answer',
    query,
    sources,
    steps,
    iterations: actualMaxIterations,
    totalTime: `${Date.now() - start}ms`,
    suggestion: 'Try increasing maxIterations or simplifying your query'
  });
}

// ─── Tool Executors ─────────────────────────────────────────────────────────
// (Same implementation as completions.ts)

async function executeWebSearch(query: string): Promise<string> {
  try {
    const searchUrl = `${JINA_READER_URL}/${DUCKDUCKGO_HTML}?q=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: {
        'Accept': 'text/plain',
        'X-Return-Format': 'text',
      },
    });

    if (!res.ok) {
      throw new Error(`Search failed: ${res.status} ${res.statusText}`);
    }

    const text = await res.text();
    return text.slice(0, 8000);  // Limit to 8k chars

  } catch (err: any) {
    console.error('[executeWebSearch] Error:', err);
    return `Error performing web search: ${err.message}`;
  }
}

async function executeWebExtract(url: string): Promise<string> {
  try {
    const extractUrl = `${JINA_READER_URL}/${url}`;
    const res = await fetch(extractUrl, {
      headers: {
        'Accept': 'text/plain',
        'X-Return-Format': 'text',
      },
    });

    if (!res.ok) {
      throw new Error(`Extract failed: ${res.status} ${res.statusText}`);
    }

    const text = await res.text();
    return text.slice(0, 12000);  // Limit to 12k chars

  } catch (err: any) {
    console.error('[executeWebExtract] Error:', err);
    return `Error extracting web content: ${err.message}`;
  }
}

// ─── a0 LLM Integration (same pattern as completions.ts) ────────────────────

interface A0Message {
  role: "system" | "user" | "assistant";
  content: string;
}

async function callA0LLM(messages: A0Message[]): Promise<string> {
  const MAX_RETRIES = 2;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const start = Date.now();

    const res = await fetch(A0_LLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        temperature: 0.7,
        max_tokens: 4096,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[callA0LLM] Error ${res.status} (${Date.now() - start}ms): ${errText.slice(0, 500)}`);
      throw new Error(`A0 API error: ${res.status} ${errText}`);
    }

    const data = await res.json();
    const completion = data.completion || '';
    console.log(`[callA0LLM] Response (${Date.now() - start}ms, attempt ${attempt + 1}): ${completion.length}ch`);

    if (completion.length > 0) {
      return completion;
    }

    // Empty completion — retry with nudge (same as completions.ts)
    if (attempt < MAX_RETRIES) {
      console.warn(`[callA0LLM] Empty completion (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying...`);
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === "user" && !lastMsg.content.includes("[Please respond")) {
        messages = [
          ...messages.slice(0, -1),
          {
            role: "user" as const,
            content: lastMsg.content + "\n\n[Please respond with your full answer. Do not leave your response empty.]",
          },
        ];
      }
    }
  }

  console.error(`[callA0LLM] Empty completion after ${MAX_RETRIES + 1} attempts`);
  return "";
}

// ─── Tool Call Parser (same as completions.ts) ──────────────────────────────

interface ParsedToolCall {
  name: string;
  arguments: Record<string, any>;
}

function parseToolCalls(text: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];
  const regex = /<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.name && parsed.arguments) {
        calls.push(parsed);
      }
    } catch {
      // Try lenient parsing - extract name and arguments
      const nameMatch = match[1].match(/"name"\s*:\s*"([^"]+)"/);
      const argsMatch = match[1].match(/"arguments"\s*:\s*(\{[^}]+\})/);
      if (nameMatch && argsMatch) {
        try {
          calls.push({ name: nameMatch[1], arguments: JSON.parse(argsMatch[1]) });
        } catch { /* skip malformed */ }
      }
    }
  }
  return calls;
}

function stripToolCalls(text: string): string {
  return text.replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/g, "").trim();
}

// ─── Reranker ───────────────────────────────────────────────────────────────

async function rerankResults(query: string, results: SearchResult[]): Promise<SearchResult[]> {
  if (results.length <= 1) return results;

  const messages: A0Message[] = [
    {
      role: "system",
      content: "You are a search relevance expert. You ALWAYS respond with valid JSON. Never respond with an empty message."
    },
    {
      role: "user",
      content: `Query: "${query}"

Results to rank:
${results.map((r, i) => `${i + 1}. Title: ${r.title}\n   Snippet: ${r.snippet}\n   URL: ${r.url}`).join('\n\n')}

Assign each result a relevance score from 0.0 to 1.0 (where 1.0 is most relevant).
Return ONLY a JSON array of scores in order, like: [0.9, 0.7, 0.5, 0.3, 0.1]
Do NOT include any other text, just the JSON array.`
    }
  ];

  try {
    const response = await callA0LLM(messages);

    // Extract JSON array from response
    const arrayMatch = response.match(/\[[\d.,\s]+\]/);
    if (!arrayMatch) {
      console.warn(`[rerankResults] Could not parse scores from: ${response.slice(0, 200)}`);
      return results;
    }

    const scores: number[] = JSON.parse(arrayMatch[0]);

    if (scores.length !== results.length) {
      console.warn(`[rerankResults] Score count mismatch: ${scores.length} vs ${results.length}`);
      return results;
    }

    // Apply scores and sort
    const rankedResults = results.map((result, idx) => ({
      ...result,
      score: scores[idx] || 0.5,
    }));

    rankedResults.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Update positions
    rankedResults.forEach((r, idx) => {
      r.position = idx + 1;
    });

    return rankedResults;

  } catch (err) {
    console.error('[rerankResults] Error:', err);
    return results;  // Fallback to original order
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseSearchResults(text: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Skip DuckDuckGo header lines (region selectors, time filters, etc.)
  // Find the first line that looks like a search result title
  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    // Look for lines followed by a URL - that's where results start
    if (i + 1 < lines.length && lines[i + 1].match(/^https?:\/\/|^\w+\.\w+\.\w+|^\w+\.\w+\//)) {
      startIdx = i;
      break;
    }
  }

  // Parse results: pattern is Title, URL (with optional date), Snippet
  let i = startIdx;
  while (i < lines.length && results.length < maxResults) {
    const line = lines[i];

    // Skip empty/short lines and known non-result lines
    if (line.length < 5 || line.startsWith('All Regions') || line.startsWith('Any Time') || line.startsWith('Past ')) {
      i++;
      continue;
    }

    // Check if this line is a title (next line should contain a URL)
    const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
    const urlMatch = nextLine.match(/(https?:\/\/[^\s]+|(?:www\.)?[\w-]+\.[\w.-]+(?:\/[^\s]*)?)/);

    if (urlMatch) {
      const title = line.replace(/\s*\|.*$/, '').trim(); // Clean title
      let url = urlMatch[1];

      // Ensure URL has protocol
      if (!url.startsWith('http')) {
        url = 'https://' + url;
      }

      // Collect snippet from remaining text on URL line and subsequent lines
      const snippetParts: string[] = [];
      const afterUrl = nextLine.replace(urlMatch[0], '').replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '').trim();
      if (afterUrl.length > 10) {
        snippetParts.push(afterUrl);
      }

      // Check if the line after URL line is snippet text (not another title)
      if (i + 2 < lines.length) {
        const snippetLine = lines[i + 2];
        const lineAfterSnippet = i + 3 < lines.length ? lines[i + 3] : '';
        const isSnippet = snippetLine.length > 15 && !lineAfterSnippet.match(/(https?:\/\/|^\w+\.\w+\.\w+|^\w+\.\w+\/)/);

        if (isSnippet && snippetParts.length === 0) {
          snippetParts.push(snippetLine);
        }
      }

      if (title.length > 3) {
        results.push({
          title,
          url,
          snippet: snippetParts.join(' ').trim().slice(0, 300),
          position: results.length + 1,
        });
      }

      i += 2; // Skip title + URL line
    } else {
      i++;
    }
  }

  return results.slice(0, maxResults);
}


function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS
    }
  });
}

// ─── KV-based API Key Management ────────────────────────────────────────────

async function checkRateLimit(apiKey: string, env: Env): Promise<{ allowed: boolean; limit: number; remaining: number; resetAt?: number }> {
  const hourBucket = getHourBucket();
  const rateLimitKey = `ratelimit:${apiKey}:${hourBucket}`;

  const currentCount = parseInt(await env.CACHE.get(rateLimitKey) || '0');
  const limit = 1000; // 1000 requests per hour default

  if (currentCount >= limit) {
    const now = new Date();
    const nextHour = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1, 0, 0, 0);

    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAt: nextHour.getTime()
    };
  }

  // Increment counter
  await env.CACHE.put(rateLimitKey, (currentCount + 1).toString(), { expirationTtl: 3600 });

  return {
    allowed: true,
    limit,
    remaining: limit - currentCount - 1
  };
}

async function incrementUsageCounter(apiKey: string, env: Env): Promise<void> {
  try {
    const keyData = await env.API_KEYS.get(apiKey, 'json');
    if (keyData) {
      keyData.totalRequests = (keyData.totalRequests || 0) + 1;
      keyData.lastUsedAt = new Date().toISOString();
      await env.API_KEYS.put(apiKey, JSON.stringify(keyData));
    }
  } catch (err) {
    console.error('[incrementUsageCounter] Error:', err);
  }
}

// ─── Utility ────────────────────────────────────────────────────────────────

function getHourBucket(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${now.getUTCDate()}-${now.getUTCHours()}`;
}

function getDayBucket(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${now.getUTCDate()}`;
}

function getNextMidnightUTC(): number {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return tomorrow.getTime();
}

// ─── Global Quota Management ────────────────────────────────────────────────

async function getGlobalQuotaStatus(env: Env) {
  const dayBucket = getDayBucket();
  const quotaKey = `global:quota:${dayBucket}`;

  const currentUsage = parseInt(await env.CACHE.get(quotaKey) || '0');
  const remaining = Math.max(0, DAILY_REQUEST_LIMIT - currentUsage);
  const percentage = Math.round((currentUsage / DAILY_REQUEST_LIMIT) * 100);

  return {
    used: currentUsage,
    limit: DAILY_REQUEST_LIMIT,
    remaining,
    percentage,
    resetsAt: getNextMidnightUTC()
  };
}

async function checkGlobalQuota(env: Env) {
  const status = await getGlobalQuotaStatus(env);

  // Exhausted (>= 95k of 95k)
  if (status.used >= DAILY_REQUEST_LIMIT * QUOTA_CRITICAL_THRESHOLD) {
    return {
      ...status,
      status: 'exhausted' as const
    };
  }

  // Critical (>= 90.25k of 95k = 95%)
  if (status.used >= DAILY_REQUEST_LIMIT * QUOTA_CRITICAL_THRESHOLD) {
    return {
      ...status,
      status: 'critical' as const
    };
  }

  // Warning (>= 76k of 95k = 80%)
  if (status.used >= DAILY_REQUEST_LIMIT * QUOTA_WARNING_THRESHOLD) {
    return {
      ...status,
      status: 'warning' as const
    };
  }

  // Normal
  return {
    ...status,
    status: 'ok' as const
  };
}

async function incrementGlobalQuota(env: Env, wasCached: boolean): Promise<void> {
  try {
    // Only count uncached requests toward quota
    if (wasCached) {
      console.log('[QUOTA] Cached request - not counted toward quota');
      return;
    }

    const dayBucket = getDayBucket();
    const quotaKey = `global:quota:${dayBucket}`;

    const currentUsage = parseInt(await env.CACHE.get(quotaKey) || '0');
    const newUsage = currentUsage + 1;

    // Cache until end of day (UTC midnight)
    const now = Date.now();
    const midnight = getNextMidnightUTC();
    const ttl = Math.floor((midnight - now) / 1000);

    await env.CACHE.put(quotaKey, newUsage.toString(), { expirationTtl: ttl });

    const percentage = Math.round((newUsage / DAILY_REQUEST_LIMIT) * 100);
    console.log(`[QUOTA] Global usage: ${newUsage}/${DAILY_REQUEST_LIMIT} (${percentage}%)`);

    // Log warnings at thresholds
    if (newUsage === Math.floor(DAILY_REQUEST_LIMIT * QUOTA_WARNING_THRESHOLD)) {
      console.warn(`[QUOTA] ⚠️ WARNING: Reached 80% of daily quota (${newUsage}/${DAILY_REQUEST_LIMIT})`);
    }
    if (newUsage === Math.floor(DAILY_REQUEST_LIMIT * QUOTA_CRITICAL_THRESHOLD)) {
      console.error(`[QUOTA] 🚨 CRITICAL: Reached 95% of daily quota (${newUsage}/${DAILY_REQUEST_LIMIT})`);
    }

  } catch (err) {
    console.error('[incrementGlobalQuota] Error:', err);
  }
}
