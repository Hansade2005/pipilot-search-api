-- Seed Data for PiPilot Search API
-- Run this after schema.sql to create test data

-- ============================================================================
-- 1. Create a test user (replace with your actual user_id from Supabase Auth)
-- ============================================================================

-- First, sign up a user through Supabase Auth UI, then get their user_id
-- Then run this to create their api_users record:

-- INSERT INTO api_users (user_id, email, name, company, tier)
-- VALUES (
--   'YOUR-AUTH-USER-ID-HERE',  -- Get this from auth.users table
--   'hans@pipilot.dev',
--   'Hans Ade',
--   'Pixelways Solutions Inc',
--   'pro'
-- );

-- ============================================================================
-- 2. Generate API Keys for the test user
-- ============================================================================

-- Function to generate API key
CREATE OR REPLACE FUNCTION generate_api_key(
  p_user_id UUID,
  p_key_name TEXT,
  p_tier TEXT DEFAULT 'free'
)
RETURNS TABLE(api_key TEXT, key_id UUID) AS $$
DECLARE
  v_key TEXT;
  v_prefix TEXT;
  v_key_id UUID;
  v_rate_limit INTEGER;
BEGIN
  -- Generate a secure random key
  -- Format: pk_{env}_{random32chars}
  v_prefix := CASE
    WHEN p_tier = 'free' THEN 'pk_test_'
    ELSE 'pk_live_'
  END;

  v_key := v_prefix || encode(gen_random_bytes(24), 'hex');

  -- Set rate limits based on tier
  v_rate_limit := CASE p_tier
    WHEN 'free' THEN 10
    WHEN 'starter' THEN 100
    WHEN 'pro' THEN 500
    WHEN 'enterprise' THEN 5000
    ELSE 10
  END;

  -- Insert the key
  INSERT INTO api_keys (user_id, key, key_prefix, key_name, rate_limit_per_minute)
  VALUES (p_user_id, v_key, SUBSTRING(v_key, 1, 12), p_key_name, v_rate_limit)
  RETURNING id INTO v_key_id;

  RETURN QUERY SELECT v_key, v_key_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 3. Example: Create test API keys (after you have a user)
-- ============================================================================

-- Uncomment and replace USER_ID after creating a user:

-- SELECT * FROM generate_api_key(
--   'YOUR-USER-ID-HERE'::UUID,
--   'Development Key',
--   'free'
-- );

-- SELECT * FROM generate_api_key(
--   'YOUR-USER-ID-HERE'::UUID,
--   'Production Key',
--   'pro'
-- );

-- ============================================================================
-- 4. Create demo waiting list entries
-- ============================================================================

INSERT INTO waiting_list (email, name, company, use_case, referral_source) VALUES
  ('demo1@example.com', 'Demo User 1', 'AI Startup Inc', 'Building AI chatbot', 'Twitter'),
  ('demo2@example.com', 'Demo User 2', 'Tech Corp', 'Research automation', 'Product Hunt'),
  ('demo3@example.com', 'Demo User 3', NULL, 'Personal project', 'Reddit')
ON CONFLICT (email) DO NOTHING;

-- ============================================================================
-- 5. Helper functions for common operations
-- ============================================================================

-- Function to get user by API key
CREATE OR REPLACE FUNCTION get_user_by_api_key(p_api_key TEXT)
RETURNS TABLE(
  user_id UUID,
  email TEXT,
  tier TEXT,
  monthly_limit INTEGER,
  requests_this_month INTEGER,
  rate_limit_per_minute INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    u.email,
    u.tier,
    u.monthly_request_limit,
    u.requests_this_month,
    k.rate_limit_per_minute
  FROM api_keys k
  JOIN api_users u ON k.user_id = u.id
  WHERE k.key = p_api_key
    AND k.is_active = TRUE
    AND u.status = 'active'
    AND (k.expires_at IS NULL OR k.expires_at > NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log API usage
CREATE OR REPLACE FUNCTION log_api_usage(
  p_api_key TEXT,
  p_endpoint TEXT,
  p_status_code INTEGER,
  p_response_time_ms INTEGER DEFAULT NULL,
  p_cached BOOLEAN DEFAULT FALSE,
  p_query_params JSONB DEFAULT NULL,
  p_ip_address INET DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_user_id UUID;
  v_api_key_id UUID;
  v_log_id UUID;
BEGIN
  -- Get user and key IDs
  SELECT u.id, k.id
  INTO v_user_id, v_api_key_id
  FROM api_keys k
  JOIN api_users u ON k.user_id = u.id
  WHERE k.key = p_api_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid API key';
  END IF;

  -- Insert usage log
  INSERT INTO api_usage_logs (
    user_id,
    api_key_id,
    endpoint,
    status_code,
    response_time_ms,
    cached,
    query_params,
    ip_address
  ) VALUES (
    v_user_id,
    v_api_key_id,
    p_endpoint,
    p_status_code,
    p_response_time_ms,
    p_cached,
    p_query_params,
    p_ip_address
  ) RETURNING id INTO v_log_id;

  -- Increment usage counter
  PERFORM increment_user_usage(v_user_id, 1);

  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to revoke API key
CREATE OR REPLACE FUNCTION revoke_api_key(p_key_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE api_keys
  SET is_active = FALSE,
      revoked_at = NOW()
  WHERE id = p_key_id
    AND user_id = p_user_id;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user statistics
CREATE OR REPLACE FUNCTION get_user_statistics(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
  v_stats JSON;
BEGIN
  SELECT json_build_object(
    'total_requests', SUM(CASE WHEN DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW()) THEN 1 ELSE 0 END),
    'total_cached', SUM(CASE WHEN cached AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW()) THEN 1 ELSE 0 END),
    'avg_response_time', ROUND(AVG(CASE WHEN DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW()) THEN response_time_ms ELSE NULL END)),
    'endpoints', json_object_agg(
      endpoint,
      COUNT(*) FILTER (WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW()))
    )
  )
  INTO v_stats
  FROM api_usage_logs
  WHERE user_id = p_user_id
  GROUP BY user_id;

  RETURN COALESCE(v_stats, '{}'::json);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 6. Scheduled jobs (set these up in Supabase Dashboard → Database → Cron)
-- ============================================================================

-- Reset monthly usage on the 1st of each month
-- Run this query in Supabase Cron:
-- SELECT reset_monthly_usage();

-- Clean up old logs (keep last 90 days)
CREATE OR REPLACE FUNCTION cleanup_old_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM api_usage_logs
  WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 7. Analytics queries (useful for dashboards)
-- ============================================================================

-- Top users by request volume
CREATE OR REPLACE VIEW top_users_by_volume AS
SELECT
  u.email,
  u.tier,
  COUNT(l.id) as total_requests,
  DATE_TRUNC('month', l.created_at) as month
FROM api_users u
LEFT JOIN api_usage_logs l ON u.id = l.user_id
WHERE l.created_at >= DATE_TRUNC('month', NOW())
GROUP BY u.email, u.tier, DATE_TRUNC('month', l.created_at)
ORDER BY total_requests DESC
LIMIT 100;

-- Endpoint popularity
CREATE OR REPLACE VIEW endpoint_popularity AS
SELECT
  endpoint,
  COUNT(*) as request_count,
  AVG(response_time_ms) as avg_response_time,
  SUM(CASE WHEN cached THEN 1 ELSE 0 END)::DECIMAL / COUNT(*) * 100 as cache_hit_rate_percent
FROM api_usage_logs
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY endpoint
ORDER BY request_count DESC;

-- Revenue projection (based on current usage)
CREATE OR REPLACE VIEW revenue_projection AS
SELECT
  u.tier,
  COUNT(DISTINCT u.id) as user_count,
  pt.monthly_price,
  COUNT(DISTINCT u.id) * pt.monthly_price as projected_mrr
FROM api_users u
JOIN pricing_tiers pt ON u.tier = pt.tier
WHERE u.status = 'active'
GROUP BY u.tier, pt.monthly_price
ORDER BY projected_mrr DESC;
