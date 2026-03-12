-- PiPilot Search API - Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. USERS TABLE (links to Supabase Auth)
-- ============================================================================
CREATE TABLE IF NOT EXISTS api_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  company TEXT,

  -- Subscription tier
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'starter', 'pro', 'enterprise')),

  -- Limits based on tier
  monthly_request_limit INTEGER NOT NULL DEFAULT 10000,
  requests_this_month INTEGER NOT NULL DEFAULT 0,

  -- Billing
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT,
  billing_email TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'cancelled')),

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_request_at TIMESTAMP WITH TIME ZONE,

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Index for fast lookups
CREATE INDEX idx_api_users_email ON api_users(email);
CREATE INDEX idx_api_users_user_id ON api_users(user_id);
CREATE INDEX idx_api_users_tier ON api_users(tier);
CREATE INDEX idx_api_users_status ON api_users(status);

-- ============================================================================
-- 2. API KEYS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES api_users(id) ON DELETE CASCADE,

  -- The actual API key (hashed in production)
  key TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL, -- First 8 chars for display (e.g., "pk_live_")
  key_name TEXT NOT NULL, -- User-friendly name

  -- Permissions
  scopes TEXT[] DEFAULT ARRAY['search', 'extract', 'smart-search'],

  -- Rate limiting
  rate_limit_per_minute INTEGER DEFAULT 100,
  rate_limit_per_day INTEGER,

  -- Usage tracking
  total_requests INTEGER DEFAULT 0,
  last_used_at TIMESTAMP WITH TIME ZONE,

  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  expires_at TIMESTAMP WITH TIME ZONE,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  revoked_at TIMESTAMP WITH TIME ZONE,

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_key ON api_keys(key);
CREATE INDEX idx_api_keys_is_active ON api_keys(is_active);
CREATE INDEX idx_api_keys_key_prefix ON api_keys(key_prefix);

-- ============================================================================
-- 3. USAGE LOGS TABLE (for analytics & billing)
-- ============================================================================
CREATE TABLE IF NOT EXISTS api_usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES api_users(id) ON DELETE CASCADE,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,

  -- Request details
  endpoint TEXT NOT NULL, -- '/search', '/extract', '/smart-search'
  method TEXT NOT NULL DEFAULT 'POST',

  -- Request data
  query_params JSONB,
  request_body JSONB,

  -- Response details
  status_code INTEGER NOT NULL,
  response_time_ms INTEGER, -- How long the request took
  cached BOOLEAN DEFAULT FALSE,

  -- Resource usage
  tokens_used INTEGER, -- For AI reranking
  credits_charged DECIMAL(10, 4) DEFAULT 1.0,

  -- Request metadata
  ip_address INET,
  user_agent TEXT,
  referer TEXT,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Partitioning by month for performance (optional but recommended)
CREATE INDEX idx_api_usage_logs_user_id ON api_usage_logs(user_id);
CREATE INDEX idx_api_usage_logs_created_at ON api_usage_logs(created_at DESC);
CREATE INDEX idx_api_usage_logs_endpoint ON api_usage_logs(endpoint);
CREATE INDEX idx_api_usage_logs_api_key_id ON api_usage_logs(api_key_id);

-- ============================================================================
-- 4. BILLING RECORDS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS billing_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES api_users(id) ON DELETE CASCADE,

  -- Billing period
  period_start TIMESTAMP WITH TIME ZONE NOT NULL,
  period_end TIMESTAMP WITH TIME ZONE NOT NULL,

  -- Usage
  total_requests INTEGER NOT NULL DEFAULT 0,
  total_credits_used DECIMAL(10, 4) DEFAULT 0,

  -- Pricing
  base_price DECIMAL(10, 2) DEFAULT 0, -- Monthly subscription fee
  overage_price DECIMAL(10, 2) DEFAULT 0, -- Extra usage charges
  total_price DECIMAL(10, 2) NOT NULL,

  -- Payment
  stripe_invoice_id TEXT UNIQUE,
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  paid_at TIMESTAMP WITH TIME ZONE,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_billing_records_user_id ON billing_records(user_id);
CREATE INDEX idx_billing_records_period ON billing_records(period_start, period_end);
CREATE INDEX idx_billing_records_payment_status ON billing_records(payment_status);

-- ============================================================================
-- 5. WAITING LIST TABLE (for pre-launch signups)
-- ============================================================================
CREATE TABLE IF NOT EXISTS waiting_list (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  company TEXT,
  use_case TEXT,

  -- Marketing
  referral_source TEXT, -- How they heard about us

  -- Status
  status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'invited', 'signed_up')),
  invited_at TIMESTAMP WITH TIME ZONE,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_waiting_list_email ON waiting_list(email);
CREATE INDEX idx_waiting_list_status ON waiting_list(status);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to reset monthly usage (run via cron)
CREATE OR REPLACE FUNCTION reset_monthly_usage()
RETURNS void AS $$
BEGIN
  UPDATE api_users
  SET requests_this_month = 0,
      updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Function to increment usage counter
CREATE OR REPLACE FUNCTION increment_user_usage(p_user_id UUID, p_requests INTEGER DEFAULT 1)
RETURNS void AS $$
BEGIN
  UPDATE api_users
  SET requests_this_month = requests_this_month + p_requests,
      last_request_at = NOW(),
      updated_at = NOW()
  WHERE id = p_user_id;

  UPDATE api_keys
  SET total_requests = total_requests + p_requests,
      last_used_at = NOW()
  WHERE user_id = p_user_id AND is_active = TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to check rate limit
CREATE OR REPLACE FUNCTION check_rate_limit(p_api_key TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_user_id UUID;
  v_monthly_limit INTEGER;
  v_requests_this_month INTEGER;
BEGIN
  SELECT u.id, u.monthly_request_limit, u.requests_this_month
  INTO v_user_id, v_monthly_limit, v_requests_this_month
  FROM api_keys k
  JOIN api_users u ON k.user_id = u.id
  WHERE k.key = p_api_key AND k.is_active = TRUE AND u.status = 'active';

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  RETURN v_requests_this_month < v_monthly_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS
ALTER TABLE api_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_records ENABLE ROW LEVEL SECURITY;

-- Users can only see their own data
CREATE POLICY "Users can view own data" ON api_users
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own data" ON api_users
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can manage their own API keys
CREATE POLICY "Users can view own keys" ON api_keys
  FOR SELECT USING (user_id IN (SELECT id FROM api_users WHERE user_id = auth.uid()));

CREATE POLICY "Users can create own keys" ON api_keys
  FOR INSERT WITH CHECK (user_id IN (SELECT id FROM api_users WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own keys" ON api_keys
  FOR UPDATE USING (user_id IN (SELECT id FROM api_users WHERE user_id = auth.uid()));

-- Users can view their own usage logs
CREATE POLICY "Users can view own logs" ON api_usage_logs
  FOR SELECT USING (user_id IN (SELECT id FROM api_users WHERE user_id = auth.uid()));

-- Users can view their own billing records
CREATE POLICY "Users can view own billing" ON billing_records
  FOR SELECT USING (user_id IN (SELECT id FROM api_users WHERE user_id = auth.uid()));

-- ============================================================================
-- INITIAL DATA (Tiers)
-- ============================================================================

-- Create a tiers reference table
CREATE TABLE IF NOT EXISTS pricing_tiers (
  tier TEXT PRIMARY KEY CHECK (tier IN ('free', 'starter', 'pro', 'enterprise')),
  name TEXT NOT NULL,
  monthly_price DECIMAL(10, 2) NOT NULL,
  monthly_request_limit INTEGER NOT NULL,
  rate_limit_per_minute INTEGER NOT NULL,
  features JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO pricing_tiers (tier, name, monthly_price, monthly_request_limit, rate_limit_per_minute, features) VALUES
  ('free', 'Free', 0.00, 10000, 10, '["10k requests/month", "All endpoints", "Community support"]'::jsonb),
  ('starter', 'Starter', 29.00, 100000, 100, '["100k requests/month", "All endpoints", "Email support", "99.9% SLA"]'::jsonb),
  ('pro', 'Pro', 149.00, 1000000, 500, '["1M requests/month", "All endpoints", "Priority support", "99.99% SLA", "Custom rate limits"]'::jsonb),
  ('enterprise', 'Enterprise', 0.00, -1, 5000, '["Unlimited requests", "All endpoints", "Dedicated support", "99.99% SLA", "Custom deployment", "SLA guarantees"]'::jsonb)
ON CONFLICT (tier) DO NOTHING;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_api_users_updated_at
  BEFORE UPDATE ON api_users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- VIEWS (for analytics dashboard)
-- ============================================================================

-- Daily usage summary
CREATE OR REPLACE VIEW daily_usage_summary AS
SELECT
  user_id,
  DATE(created_at) as date,
  endpoint,
  COUNT(*) as request_count,
  AVG(response_time_ms) as avg_response_time,
  SUM(CASE WHEN cached THEN 1 ELSE 0 END) as cached_requests,
  SUM(credits_charged) as total_credits
FROM api_usage_logs
GROUP BY user_id, DATE(created_at), endpoint;

-- Monthly usage summary
CREATE OR REPLACE VIEW monthly_usage_summary AS
SELECT
  user_id,
  DATE_TRUNC('month', created_at) as month,
  COUNT(*) as request_count,
  SUM(credits_charged) as total_credits,
  AVG(response_time_ms) as avg_response_time
FROM api_usage_logs
GROUP BY user_id, DATE_TRUNC('month', created_at);

-- User stats view
CREATE OR REPLACE VIEW user_stats AS
SELECT
  u.id,
  u.email,
  u.tier,
  u.requests_this_month,
  u.monthly_request_limit,
  ROUND((u.requests_this_month::DECIMAL / NULLIF(u.monthly_request_limit, 0)) * 100, 2) as usage_percentage,
  (SELECT COUNT(*) FROM api_keys WHERE user_id = u.id AND is_active = TRUE) as active_keys,
  u.created_at,
  u.last_request_at
FROM api_users u;

-- ============================================================================
-- GRANTS (if needed for service role)
-- ============================================================================

-- Grant necessary permissions to authenticated users
GRANT SELECT, INSERT, UPDATE ON api_users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api_keys TO authenticated;
GRANT SELECT ON api_usage_logs TO authenticated;
GRANT SELECT ON billing_records TO authenticated;
GRANT SELECT ON pricing_tiers TO anon, authenticated;

-- Service role needs full access for background jobs
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE api_users IS 'Main users table for API customers';
COMMENT ON TABLE api_keys IS 'API keys for authentication';
COMMENT ON TABLE api_usage_logs IS 'Detailed request logs for analytics and billing';
COMMENT ON TABLE billing_records IS 'Monthly billing records';
COMMENT ON TABLE pricing_tiers IS 'Available subscription tiers';
COMMENT ON TABLE waiting_list IS 'Pre-launch waiting list signups';
