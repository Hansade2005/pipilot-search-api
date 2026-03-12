# PiPilot Search API - Product Launch Guide

Complete guide to launch your search API as a product with user management, billing, and analytics.

---

## 🗄️ **Database Setup (Supabase)**

### Step 1: Run Database Migrations

1. Go to **Supabase Dashboard**: https://supabase.com/dashboard
2. Select your project (or create one for `pipilot-search-api`)
3. Go to **SQL Editor**
4. Run these files in order:

**File 1: `database/schema.sql`**
- Creates all tables (users, API keys, usage logs, billing)
- Sets up Row Level Security (RLS)
- Creates helper functions
- Creates analytics views

**File 2: `database/seed.sql`**
- Creates helper functions for API key generation
- Sets up test data
- Creates analytics views

### Step 2: Get Supabase Credentials

From Supabase Dashboard → Settings → API:

```bash
# Add to your .env file:
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... # Keep this secret!
```

### Step 3: Update Cloudflare Worker

Add Supabase credentials to `wrangler.toml`:

```toml
[vars]
ENVIRONMENT = "production"
VERSION = "1.0.0"
SUPABASE_URL = "https://your-project.supabase.co"

# Add secret (don't commit this!)
# Run: npx wrangler secret put SUPABASE_SERVICE_KEY
```

---

## 🔑 **API Key Management System**

### Option A: Using Supabase Functions (Recommended)

Create API endpoint for key management in your PiPilot app:

```typescript
// app/api/keys/generate/route.ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(request: Request) {
  const { userId, keyName, tier } = await request.json();

  // Generate API key
  const { data, error } = await supabase.rpc('generate_api_key', {
    p_user_id: userId,
    p_key_name: keyName,
    p_tier: tier
  });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    apiKey: data[0].api_key,
    keyId: data[0].key_id,
    message: 'API key generated successfully'
  });
}
```

### Option B: Manual Key Generation (For Testing)

1. Sign up a user through Supabase Auth
2. Get their `user_id` from `auth.users` table
3. Run this SQL:

```sql
-- Get your user_id first
SELECT id, email FROM auth.users WHERE email = 'your@email.com';

-- Create api_users record
INSERT INTO api_users (user_id, email, name, tier)
VALUES (
  'YOUR-USER-ID',
  'your@email.com',
  'Your Name',
  'free'
);

-- Generate API key
SELECT * FROM generate_api_key(
  'YOUR-USER-ID'::UUID,
  'My First Key',
  'free'
);
```

Copy the generated API key and use it!

---

## 📊 **Usage Tracking Integration**

### Update Cloudflare Worker to Log Usage

Modify `src/index.ts` to track usage in Supabase:

```typescript
// Add to src/index.ts

interface Env {
  CACHE: KVNamespace;
  API_KEYS: KVNamespace;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

async function logUsage(
  apiKey: string,
  endpoint: string,
  statusCode: number,
  responseTimeMs: number,
  cached: boolean,
  env: Env
) {
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/log_api_usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({
        p_api_key: apiKey,
        p_endpoint: endpoint,
        p_status_code: statusCode,
        p_response_time_ms: responseTimeMs,
        p_cached: cached
      })
    });
  } catch (err) {
    console.error('[logUsage] Error:', err);
    // Don't fail the request if logging fails
  }
}

// Use in handlers:
async function handleSearch(request: Request, env: Env): Promise<Response> {
  const start = Date.now();
  const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '');

  // ... existing search logic ...

  const responseTime = Date.now() - start;

  // Log usage
  await logUsage(apiKey, '/search', 200, responseTime, cached, env);

  return response;
}
```

---

## 🌐 **Landing Page**

### Create Landing Page in Your PiPilot App

```typescript
// app/api-search/page.tsx
export default function SearchAPILanding() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black text-white">
      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20">
        <h1 className="text-6xl font-bold mb-6">
          The Most Powerful, Cheapest AI Search API
        </h1>
        <p className="text-2xl text-gray-300 mb-8">
          Built for AI agents. 96%+ accuracy. $1-2/1k requests. 10k free requests/month.
        </p>

        <div className="flex gap-4">
          <a href="#pricing" className="bg-blue-600 hover:bg-blue-700 px-8 py-4 rounded-lg text-lg font-semibold">
            Get Started Free
          </a>
          <a href="https://github.com/Hansade2005/pipilot-search-api" className="border border-gray-600 hover:border-gray-500 px-8 py-4 rounded-lg text-lg font-semibold">
            View Docs
          </a>
        </div>
      </section>

      {/* Features */}
      <section className="container mx-auto px-4 py-20">
        <h2 className="text-4xl font-bold mb-12 text-center">Why PiPilot Search API?</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <FeatureCard
            title="Fastest Performance"
            description="<250ms uncached, <50ms cached. 7x faster than competitors."
            icon="⚡"
          />
          <FeatureCard
            title="Cheapest Pricing"
            description="$1-2/1k vs $5/1k competitors. 60-80% cost savings."
            icon="💰"
          />
          <FeatureCard
            title="Highest Accuracy"
            description="96%+ SimpleQA benchmark. AI-powered reranking included."
            icon="🎯"
          />
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="container mx-auto px-4 py-20">
        <h2 className="text-4xl font-bold mb-12 text-center">Simple, Transparent Pricing</h2>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <PricingCard
            tier="Free"
            price="$0"
            requests="10k/month"
            features={['All endpoints', 'Community support', 'No credit card']}
          />
          <PricingCard
            tier="Starter"
            price="$29"
            requests="100k/month"
            features={['All endpoints', 'Email support', '99.9% SLA']}
            highlighted
          />
          <PricingCard
            tier="Pro"
            price="$149"
            requests="1M/month"
            features={['All endpoints', 'Priority support', '99.99% SLA', 'Custom limits']}
          />
          <PricingCard
            tier="Enterprise"
            price="Custom"
            requests="Unlimited"
            features={['Dedicated support', 'SLA guarantees', 'Custom deployment']}
          />
        </div>
      </section>

      {/* CTA */}
      <section className="container mx-auto px-4 py-20 text-center">
        <h2 className="text-4xl font-bold mb-6">Ready to Build?</h2>
        <p className="text-xl text-gray-300 mb-8">
          Start with 10,000 free requests. No credit card required.
        </p>
        <a href="/signup" className="bg-blue-600 hover:bg-blue-700 px-12 py-4 rounded-lg text-xl font-semibold inline-block">
          Get Your API Key
        </a>
      </section>
    </div>
  );
}
```

---

## 📈 **Analytics Dashboard**

### Create Dashboard in PiPilot App

```typescript
// app/dashboard/api-keys/page.tsx
import { createClient } from '@supabase/supabase-js';

export default async function APIKeysDashboard() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!
  );

  // Get user's API keys
  const { data: keys } = await supabase
    .from('api_keys')
    .select('*')
    .order('created_at', { ascending: false });

  // Get usage stats
  const { data: stats } = await supabase
    .from('user_stats')
    .select('*')
    .single();

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">API Keys</h1>

      {/* Usage Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <StatCard title="Requests This Month" value={stats.requests_this_month} />
        <StatCard title="Monthly Limit" value={stats.monthly_request_limit} />
        <StatCard title="Usage" value={`${stats.usage_percentage}%`} />
        <StatCard title="Active Keys" value={stats.active_keys} />
      </div>

      {/* API Keys List */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">Your API Keys</h2>
          <button className="bg-blue-600 text-white px-4 py-2 rounded">
            Create New Key
          </button>
        </div>

        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left py-3">Name</th>
              <th className="text-left py-3">Key</th>
              <th className="text-left py-3">Total Requests</th>
              <th className="text-left py-3">Last Used</th>
              <th className="text-left py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys?.map(key => (
              <tr key={key.id} className="border-b">
                <td className="py-3">{key.key_name}</td>
                <td className="py-3 font-mono text-sm">{key.key_prefix}...</td>
                <td className="py-3">{key.total_requests.toLocaleString()}</td>
                <td className="py-3">{new Date(key.last_used_at).toLocaleDateString()}</td>
                <td className="py-3">
                  <button className="text-red-600 hover:text-red-800">
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

---

## 🚀 **Launch Checklist**

### Week 1: Setup

- [ ] Run database migrations in Supabase
- [ ] Update Cloudflare Worker with Supabase integration
- [ ] Test API key generation
- [ ] Test usage tracking
- [ ] Create landing page
- [ ] Create dashboard

### Week 2: Beta Launch

- [ ] Invite 50-100 beta users
- [ ] Set up email notifications (welcome, usage alerts)
- [ ] Monitor for bugs
- [ ] Collect feedback
- [ ] Iterate on features

### Week 3: Public Launch

- [ ] Post on Product Hunt
- [ ] Post on Hacker News
- [ ] Tweet announcement
- [ ] Write launch blog post
- [ ] Add to API marketplace (RapidAPI, etc.)

### Week 4: Growth

- [ ] Add Stripe billing integration
- [ ] Create referral program
- [ ] Partner with LangChain/LlamaIndex
- [ ] Create video demos
- [ ] Write case studies

---

## 💳 **Billing Integration (Stripe)**

### Step 1: Create Stripe Products

1. Go to Stripe Dashboard → Products
2. Create products for each tier:
   - Starter: $29/month
   - Pro: $149/month
   - Enterprise: Custom

### Step 2: Add Stripe to PiPilot App

```bash
npm install @stripe/stripe-js stripe
```

```typescript
// app/api/create-subscription/route.ts
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(request: Request) {
  const { tier, userId } = await request.json();

  // Create Stripe customer
  const customer = await stripe.customers.create({
    email: user.email,
    metadata: { userId }
  });

  // Create subscription
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: PRICE_IDS[tier] }],
    payment_behavior: 'default_incomplete',
    expand: ['latest_invoice.payment_intent']
  });

  // Save to database
  await supabase
    .from('api_users')
    .update({
      stripe_customer_id: customer.id,
      stripe_subscription_id: subscription.id,
      tier: tier
    })
    .eq('id', userId);

  return Response.json({ subscriptionId: subscription.id });
}
```

---

## 📊 **Analytics & Monitoring**

### Supabase Analytics

Use the built-in views:

```sql
-- Daily usage
SELECT * FROM daily_usage_summary WHERE user_id = 'YOUR-USER-ID';

-- Monthly summary
SELECT * FROM monthly_usage_summary;

-- Top users
SELECT * FROM top_users_by_volume;

-- Revenue projection
SELECT * FROM revenue_projection;
```

### Cloudflare Analytics

Check: Cloudflare Dashboard → Workers & Pages → pipilot-search-api → Metrics

---

## 🎯 **Success Metrics**

Track these KPIs:

- **Users**: Total signups, active users, churn rate
- **Revenue**: MRR, ARPU, LTV
- **Usage**: Requests/day, cache hit rate, error rate
- **Performance**: p50/p95/p99 latency, uptime
- **Support**: Tickets/week, response time, satisfaction

---

## 🆘 **Support**

- **Email**: hello@pipilot.dev
- **Discord**: Create a community channel
- **Docs**: Keep README.md updated
- **Status Page**: Create status.pipilot.dev

---

Built with ❤️ by Hans Ade @ Pixelways Solutions Inc
