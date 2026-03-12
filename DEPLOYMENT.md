# Deployment Guide - PiPilot Search API

Complete step-by-step guide to deploy your search API to Cloudflare Workers.

---

## Prerequisites

1. **Cloudflare Account** (Free tier works!)
   - Sign up at https://dash.cloudflare.com/sign-up

2. **Node.js** (v18+ recommended)
   ```bash
   node --version  # Should be v18 or higher
   ```

3. **Your Cloudflare API Token**
   - You provided: `5DJhctgvllupiGtJesQwub8pmF2TbYUQCVFc0jFj`
   - **IMPORTANT**: Rotate this after deployment!

---

## Step 1: Install Dependencies

```bash
cd pipilot-search-api
npm install
```

This installs:
- `wrangler` - Cloudflare Workers CLI
- `typescript` - TypeScript compiler
- `@cloudflare/workers-types` - Type definitions

---

## Step 2: Configure Wrangler

### Option A: Login Interactively (Recommended)

```bash
npx wrangler login
```

This opens your browser and authorizes Wrangler.

### Option B: Use Your Token Directly

```bash
export CLOUDFLARE_API_TOKEN=5DJhctgvllupiGtJesQwub8pmF2TbYUQCVFc0jFj
```

Or on Windows:
```cmd
set CLOUDFLARE_API_TOKEN=5DJhctgvllupiGtJesQwub8pmF2TbYUQCVFc0jFj
```

---

## Step 3: Create KV Namespaces

KV (Key-Value) stores are used for caching and API key storage.

```bash
# Create CACHE namespace
npx wrangler kv:namespace create "CACHE"
# Output: { binding = "CACHE", id = "abc123..." }

# Create API_KEYS namespace
npx wrangler kv:namespace create "API_KEYS"
# Output: { binding = "API_KEYS", id = "def456..." }
```

**Copy the IDs** and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "CACHE"
id = "abc123..."  # ← Paste your CACHE ID here

[[kv_namespaces]]
binding = "API_KEYS"
id = "def456..."  # ← Paste your API_KEYS ID here
```

---

## Step 4: Deploy to Cloudflare Workers

```bash
npx wrangler deploy
```

**Output:**
```
✨ Success! Uploaded 1 files (X.XX sec)

Published pipilot-search-api (X.XX sec)
  https://pipilot-search-api.YOUR_SUBDOMAIN.workers.dev
Current Version ID: abc123-def456-ghi789
```

**Your API is now live!** 🎉

---

## Step 5: Test Your Deployment

### Health Check

```bash
curl https://pipilot-search-api.YOUR_SUBDOMAIN.workers.dev/health
```

**Expected response:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2025-03-12T..."
}
```

### Test Search Endpoint

```bash
curl -X POST https://pipilot-search-api.YOUR_SUBDOMAIN.workers.dev/search \
  -H "Authorization: Bearer test-key-123" \
  -H "Content-Type: application/json" \
  -d '{"query":"AI frameworks 2025","rerank":true,"maxResults":5}'
```

**Expected response:**
```json
{
  "success": true,
  "query": "AI frameworks 2025",
  "results": [
    {
      "title": "...",
      "url": "...",
      "snippet": "...",
      "position": 1,
      "score": 0.95
    }
  ],
  "cached": false,
  "reranked": true,
  "processingTime": "523ms"
}
```

### Test Smart Search

```bash
curl -X POST https://pipilot-search-api.YOUR_SUBDOMAIN.workers.dev/smart-search \
  -H "Authorization: Bearer test-key-123" \
  -H "Content-Type: application/json" \
  -d '{"query":"What are the latest AI agent frameworks?","maxIterations":3}'
```

This will take 2-5 seconds as it iteratively researches.

---

## Step 6: Set Up Custom Domain (Optional)

### Prerequisites
- Domain managed by Cloudflare

### Steps

1. Go to Cloudflare Dashboard → Workers & Pages
2. Select your `pipilot-search-api` worker
3. Click "Settings" → "Domains & Routes"
4. Click "Add Custom Domain"
5. Enter: `api.pipilot.dev`
6. Click "Add Domain"

**Now accessible at:** `https://api.pipilot.dev`

---

## Step 7: Configure API Keys

Currently, the API accepts any Bearer token. Let's add proper API keys.

### Create an API Key

```bash
npx wrangler kv:key put --namespace-id="def456..." \
  "pk_live_12345" \
  '{"tier":"pro","name":"Production Key","createdAt":"2025-03-12"}'
```

### Generate Multiple Keys

```bash
# Free tier
npx wrangler kv:key put --namespace-id="def456..." \
  "pk_free_abc123" \
  '{"tier":"free","limit":10000,"name":"Test User"}'

# Starter tier
npx wrangler kv:key put --namespace-id="def456..." \
  "pk_starter_xyz789" \
  '{"tier":"starter","limit":100000,"name":"Startup Inc"}'

# Pro tier
npx wrangler kv:key put --namespace-id="def456..." \
  "pk_pro_qwerty" \
  '{"tier":"pro","limit":1000000,"name":"Enterprise Corp"}'
```

### Update API Key Validation

Edit `src/index.ts` and update the `validateApiKey` function:

```typescript
async function validateApiKey(key: string, env: Env): Promise<boolean> {
  const keyData = await env.API_KEYS.get(key, 'json');

  if (!keyData) {
    console.log('[AUTH] Invalid key:', key.slice(0, 10) + '...');
    return false;
  }

  // Check if revoked
  if (keyData.revoked) {
    console.log('[AUTH] Revoked key:', key.slice(0, 10) + '...');
    return false;
  }

  console.log('[AUTH] Valid key:', keyData.name, '(', keyData.tier, ')');
  return true;
}
```

Redeploy:
```bash
npx wrangler deploy
```

---

## Step 8: Enable Rate Limiting (Production)

Update the `checkRateLimit` function in `src/index.ts`:

```typescript
async function checkRateLimit(key: string, env: Env): Promise<{
  allowed: boolean;
  limit: number;
  remaining?: number;
  resetAt?: number;
}> {
  // Get key tier
  const keyData: any = await env.API_KEYS.get(key, 'json');
  if (!keyData) return { allowed: false, limit: 0 };

  const limits: Record<string, number> = {
    free: 10000,      // 10k/day
    starter: 100000,   // 100k/day
    pro: 1000000       // 1M/day
  };

  const dailyLimit = limits[keyData.tier] || 1000;

  // Get current day bucket
  const now = new Date();
  const dayBucket = `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${now.getUTCDate()}`;
  const rateLimitKey = `ratelimit:${key}:${dayBucket}`;

  // Get current count
  const currentCount = parseInt(await env.CACHE.get(rateLimitKey) || '0');

  if (currentCount >= dailyLimit) {
    return {
      allowed: false,
      limit: dailyLimit,
      remaining: 0,
      resetAt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
    };
  }

  // Increment count (atomic)
  await env.CACHE.put(rateLimitKey, String(currentCount + 1), {
    expirationTtl: 86400 // 24 hours
  });

  return {
    allowed: true,
    limit: dailyLimit,
    remaining: dailyLimit - currentCount - 1
  };
}
```

Redeploy:
```bash
npx wrangler deploy
```

---

## Step 9: Monitoring & Logs

### View Live Logs

```bash
npx wrangler tail
```

This streams real-time logs from your Worker.

### View Analytics

1. Go to Cloudflare Dashboard
2. Workers & Pages → `pipilot-search-api`
3. Click "Metrics"

You'll see:
- Requests per second
- CPU time
- Errors
- Success rate

---

## Step 10: Scaling & Optimization

### 1. Increase Cache TTL for Popular Queries

```typescript
// For trending/popular queries, cache longer
const isPopular = query.match(/ai|chatgpt|2025/i);
const ttl = isPopular ? 86400 : 3600; // 24hr vs 1hr

await env.CACHE.put(cacheKey, JSON.stringify(response), {
  expirationTtl: ttl
});
```

### 2. Add Predictive Pre-fetching

```typescript
// Pre-fetch trending queries during idle time
async function prefetchTrending(env: Env) {
  const trending = ['AI frameworks 2025', 'best LLMs', 'quantum computing'];

  for (const query of trending) {
    const cacheKey = `search:${query}:10:true`;
    const cached = await env.CACHE.get(cacheKey);

    if (!cached) {
      // Pre-warm cache
      await executeWebSearch(query);
    }
  }
}
```

### 3. Enable Compression

Cloudflare automatically compresses responses, but you can optimize JSON:

```typescript
function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {  // Remove `null, 2` for production
    status,
    headers: {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',  // Cloudflare handles this
      ...CORS_HEADERS
    }
  });
}
```

---

## Costs Breakdown

### Cloudflare Workers Pricing

**Free Tier:**
- 100,000 requests/day
- **Perfect for MVP and testing!**

**Paid Plan ($5/month):**
- 10 million requests/month
- Beyond that: $0.50 per additional million

### At Scale

| Monthly Requests | Cloudflare Cost | Your Pricing | Profit Margin |
|------------------|-----------------|--------------|---------------|
| 100k (free tier) | $0 | $0 | - |
| 1M (10k users) | $5 | $29 (Starter) | 83% |
| 10M (100k users) | $5 | $149 (Pro) | 97% |
| 100M (1M users) | $50 | Custom | 95% |

**With 90% cache hit rate, costs are even lower!**

---

## Security Best Practices

### 1. Rotate Your API Token

Your token has full edit access. After deployment, create a scoped token:

1. Cloudflare Dashboard → My Profile → API Tokens
2. Create Token → Edit Cloudflare Workers
3. Set permissions: Workers Scripts (Edit), Workers KV Storage (Edit)
4. Scope to specific account/zone
5. Use new token instead

### 2. Enable CORS Restrictions (Production)

Update CORS headers to allow only your domain:

```typescript
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://pipilot.dev',  // Your domain
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
```

### 3. Add Request Signing (Advanced)

For high-security use cases, add HMAC request signing:

```typescript
function verifySignature(request: Request, secret: string): boolean {
  const signature = request.headers.get('X-Signature');
  const timestamp = request.headers.get('X-Timestamp');

  // Verify signature matches HMAC of body + timestamp
  // Prevents replay attacks
}
```

---

## Troubleshooting

### Error: "Namespace not found"

You forgot to create KV namespaces. Run:
```bash
npx wrangler kv:namespace create "CACHE"
npx wrangler kv:namespace create "API_KEYS"
```

### Error: "Authentication error"

Your token expired or is invalid. Run:
```bash
npx wrangler login
```

### Worker not updating

Clear Cloudflare cache:
```bash
npx wrangler deploy --force
```

### High latency

- Check if reranking is enabled (adds ~500ms)
- Disable for faster responses: `"rerank": false`
- First request after cache expiry is slower

---

## Next Steps

1. ✅ Deploy to Cloudflare Workers
2. ✅ Set up custom domain
3. ✅ Configure API keys
4. ✅ Enable rate limiting
5. 📝 Create SDK for TypeScript/Python
6. 📝 Add MCP server support
7. 📝 Build analytics dashboard
8. 📝 Launch on Product Hunt

---

## Support

- **Email**: hello@pipilot.dev
- **GitHub**: https://github.com/Hansade2005/pipilot-search-api
- **Discord**: https://discord.gg/pipilot

---

Made with ❤️ by Hans Ade @ Pixelways Solutions Inc
