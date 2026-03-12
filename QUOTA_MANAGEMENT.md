# PiPilot Search API - Quota Management System

## Overview

The PiPilot Search API implements a **comprehensive global quota management system** to ensure continuous operation within Cloudflare Workers' free tier limits (100,000 requests/day) with **zero downtime**.

## 📊 Quota Limits

- **Cloudflare Free Tier:** 100,000 requests/day
- **PiPilot Configured Limit:** 95,000 requests/day (5,000 buffer for safety)
- **Reset Time:** Daily at 00:00 UTC

## 🎯 Quota States

The API operates in four distinct states based on usage:

### 1. **OK State** (0-79% usage, 0-75,050 requests)
- **Status:** Normal operation
- **Behavior:** All endpoints fully available
- **Features:** Search, extract, smart-search, reranking all enabled
- **User Experience:** Fast, full-featured responses

### 2. **Warning State** (80-94% usage, 76,000-89,299 requests)
- **Status:** Cache-only mode activated
- **Behavior:** Only cached results served
- **Features:**
  - ✅ Cached search results: Available
  - ✅ Cached extracts: Available
  - ❌ New searches: Returns 503
  - ❌ New extracts: Returns 503
  - ❌ Smart search: Returns 503
  - ❌ AI reranking: Disabled
- **Headers Added:**
  - `X-Cache-Only-Mode: true`
  - `X-Quota-Warning: Approaching daily limit - serving cached results only`
- **User Experience:** Fast cached responses, degraded for new queries

### 3. **Critical State** (95-99% usage, 90,250-94,049 requests)
- **Status:** Cache-only mode (same as Warning)
- **Behavior:** Same as Warning State
- **Purpose:** Last chance buffer before exhaustion

### 4. **Exhausted State** (≥95,000 requests)
- **Status:** Service quota exhausted
- **Behavior:** Service unavailable
- **Response:** `503 Service Unavailable`
- **Error Message:**
  ```json
  {
    "error": "Service quota exhausted",
    "message": "Daily API quota reached. Service will resume tomorrow.",
    "quota": {
      "used": 95000,
      "limit": 95000,
      "resetsAt": 1773360000000
    },
    "retryAfter": 62341
  }
  ```
- **User Experience:** Temporary outage, auto-resume at midnight UTC

## 📈 Smart Quota Counting

**Only uncached requests count toward quota:**

- ✅ Cached search result: **0 quota used**
- ✅ Cached extract: **0 quota used**
- ❌ New search (cache miss): **1 quota used**
- ❌ New extract (cache miss): **1 quota used**
- ❌ Smart search iteration: **1 quota per tool call**

**Why this matters:**
- 90%+ cache hit rate means effective capacity = **950,000+ requests/day**
- Actual external API calls limited to 95,000/day
- Cloudflare still has 5,000 request buffer

## 🔍 Monitoring Quota

### Health Endpoint

```bash
curl https://pipilot-search-api.hanscadx8.workers.dev/health
```

**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2026-03-12T07:04:10.668Z",
  "quota": {
    "used": 1,
    "limit": 95000,
    "remaining": 94999,
    "percentage": 0,
    "resetsAt": 1773360000000
  }
}
```

### Response Headers (All Endpoints)

Every API response includes quota headers:

```
X-Quota-Used: 1234
X-Quota-Remaining: 93766
X-Quota-Limit: 95000
X-Processing-Time: 450ms
X-Cached: true|false
```

In cache-only mode:
```
X-Cache-Only-Mode: true
X-Quota-Warning: Approaching daily limit - serving cached results only
```

## 🎛️ Technical Implementation

### Global Quota Tracking

```typescript
// KV Storage Key Format
const quotaKey = `global:quota:${YYYY-MM-DD}`;

// Auto-expires at UTC midnight
const ttl = secondsUntilMidnight;

// Increment only for uncached requests
await env.CACHE.put(quotaKey, newUsage.toString(), { expirationTtl: ttl });
```

### Quota Check Flow

```
Request → Check Global Quota → Quota State?
                                    ↓
            ┌───────────────────────┼───────────────────────┐
            ↓                       ↓                       ↓
          OK (0-79%)            Warning (80-94%)        Exhausted (≥95k)
            ↓                       ↓                       ↓
       Full Service          Cache-Only Mode           503 Error
            ↓                       ↓                       ↓
     Auth Check              Auth Check                Return 503
            ↓                       ↓
     Rate Limit              Rate Limit
            ↓                       ↓
     Execute                 Check Cache
            ↓                       ↓
     Response           Cache Hit? Yes → Response
                                   ↓ No
                              Return 503
```

### Cache-Only Mode Logic

```typescript
async function handleSearch(request, env, cacheOnlyMode = false) {
  // Check cache first
  const cached = await env.CACHE.get(cacheKey, 'json');
  if (cached) {
    return jsonResponse({ ...cached, cached: true });
  }

  // If cache-only mode and no cache, return error
  if (cacheOnlyMode) {
    return jsonResponse({
      error: 'Cache miss in quota-limited mode',
      message: 'Daily quota approaching limit. Only cached results available.',
      suggestion: 'Try a more common search query that may be cached'
    }, 503);
  }

  // Normal mode: execute search
  const results = await executeWebSearch(query);
  // ...
}
```

## 📊 Logging & Alerts

Console logs track quota status:

```
[QUOTA] Global usage: 1/95000 (0%)
[QUOTA] Cached request - not counted toward quota
[QUOTA] ⚠️ WARNING: Reached 80% of daily quota (76000/95000)
[QUOTA] 🚨 CRITICAL: Reached 95% of daily quota (90250/95000)
```

## 🚀 Benefits

1. **Zero Downtime:** Graceful degradation instead of hard failure
2. **Cost Efficiency:** Stay within free tier while serving 950k+ cached requests
3. **Smart Caching:** 90%+ hit rate multiplies effective capacity 10x
4. **Transparency:** Real-time quota visibility via headers and /health
5. **Safety Buffer:** 5k request cushion before Cloudflare hard limit
6. **Auto-Recovery:** Automatic reset at midnight UTC

## 🎯 User Experience by Scenario

### Scenario 1: Normal Day (10k requests)
- **Experience:** All features work perfectly
- **Performance:** Fast responses, full functionality
- **Cost:** $0 (well within free tier)

### Scenario 2: High Traffic Day (80k requests, 90% cached)
- **Quota Used:** 8,000 (only uncached)
- **Experience:** All features work perfectly
- **Cost:** $0 (well within free tier)

### Scenario 3: Very High Traffic (100k requests, 90% cached)
- **Quota Used:** 10,000 (only uncached)
- **Experience:** All features work perfectly
- **Cost:** $0 (well within free tier)

### Scenario 4: Extreme Traffic (500k requests, 80% cached)
- **Quota Used:** 100,000 (uncached)
- **0-76k:** Normal operation
- **76k-90k:** Cache-only mode (cached results still served fast)
- **90k-95k:** Cache-only mode (critical state)
- **95k+:** Service unavailable until midnight UTC
- **Experience:** Degraded but functional for most users
- **Cost:** $0 (free tier maintained)

### Scenario 5: Attack/Abuse (1M unique requests)
- **0-76k:** Normal operation
- **76k-95k:** Cache-only mode (most attacks fail here)
- **95k+:** Service unavailable
- **Protection:** Quota prevents runaway costs
- **Recovery:** Automatic at midnight UTC
- **Cost:** $0 (protected by quota limits)

## 🛡️ Protection Against Abuse

The quota system protects against:

1. **DDoS attacks:** Service degrades gracefully, doesn't crash
2. **API key leaks:** Quota limits damage to 95k requests/day
3. **Runaway loops:** Quota prevents infinite request scenarios
4. **Cost overruns:** Stay within free tier no matter what

## 📝 Best Practices for Developers

### 1. Monitor Quota Status

```bash
# Check before bulk operations
curl https://pipilot-search-api.hanscadx8.workers.dev/health

# Respect cache-only mode
if response.headers['X-Cache-Only-Mode'] == 'true':
    # Adjust expectations - cached results only
```

### 2. Handle 503 Gracefully

```typescript
try {
  const response = await fetch('/search', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ query })
  });

  if (response.status === 503) {
    const error = await response.json();

    if (error.retryAfter) {
      // Quota exhausted - retry tomorrow
      const retryDate = new Date(error.quota.resetsAt);
      console.log(`Service resumes at ${retryDate}`);
    } else {
      // Cache miss in cache-only mode
      console.log('Try a different query or wait for quota reset');
    }
  }
} catch (err) {
  // Handle error
}
```

### 3. Leverage Caching

```bash
# Popular queries are likely cached
/search?query="JavaScript tutorial"  # High cache hit probability
/search?query="xyzabc123random"      # Low cache hit probability

# If approaching quota limit, use common queries
if quotaRemaining < 1000:
    use_popular_queries_only()
```

## 🔧 Configuration

Current settings (in `src/index.ts`):

```typescript
const DAILY_REQUEST_LIMIT = 95000;
const QUOTA_WARNING_THRESHOLD = 0.8;  // 80% = 76k requests
const QUOTA_CRITICAL_THRESHOLD = 0.95; // 95% = 90.25k requests
```

To adjust thresholds, modify these constants and redeploy.

## 📊 Quota Dashboard (Future)

Planned features for PiPilot dashboard:

- Real-time quota usage graphs
- Historical usage patterns
- Quota alerts and notifications
- Per-API-key quota tracking
- Usage forecasting
- Auto-scaling alerts

---

**Result:** The PiPilot Search API can effectively handle **950,000+ requests/day** (with 90% cache hit rate) while staying within Cloudflare's 100k free tier limit, ensuring **zero downtime** and **zero cost**. 🚀
