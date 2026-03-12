/**
 * Supabase Integration for PiPilot Search API Worker
 *
 * This module handles:
 * - API key validation against Supabase
 * - Usage logging to Supabase
 * - Rate limiting checks
 */

export interface SupabaseUser {
  user_id: string;
  email: string;
  tier: string;
  monthly_limit: number;
  requests_this_month: number;
  rate_limit_per_minute: number;
}

export interface SupabaseEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

/**
 * Validate API key and get user info from Supabase
 */
export async function validateApiKey(
  apiKey: string,
  env: SupabaseEnv
): Promise<SupabaseUser | null> {
  try {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/rpc/get_user_by_api_key`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({ p_api_key: apiKey }),
      }
    );

    if (!response.ok) {
      console.error('[validateApiKey] Supabase error:', response.status);
      return null;
    }

    const data = await response.json();

    if (!data || data.length === 0) {
      console.log('[validateApiKey] Invalid API key');
      return null;
    }

    const user = data[0];

    return {
      user_id: user.user_id,
      email: user.email,
      tier: user.tier,
      monthly_limit: user.monthly_limit,
      requests_this_month: user.requests_this_month,
      rate_limit_per_minute: user.rate_limit_per_minute,
    };
  } catch (err: any) {
    console.error('[validateApiKey] Error:', err);
    return null;
  }
}

/**
 * Check if user has exceeded rate limit
 */
export function checkRateLimit(user: SupabaseUser): {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt?: number;
} {
  const remaining = user.monthly_limit - user.requests_this_month;

  if (remaining <= 0) {
    // Calculate reset time (1st of next month)
    const now = new Date();
    const resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();

    return {
      allowed: false,
      limit: user.monthly_limit,
      remaining: 0,
      resetAt,
    };
  }

  return {
    allowed: true,
    limit: user.monthly_limit,
    remaining,
  };
}

/**
 * Log API usage to Supabase
 */
export async function logUsage(
  apiKey: string,
  endpoint: string,
  statusCode: number,
  responseTimeMs: number,
  cached: boolean,
  env: SupabaseEnv,
  ipAddress?: string
): Promise<void> {
  try {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/rpc/log_api_usage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({
          p_api_key: apiKey,
          p_endpoint: endpoint,
          p_status_code: statusCode,
          p_response_time_ms: responseTimeMs,
          p_cached: cached,
          p_ip_address: ipAddress || null,
        }),
      }
    );

    if (!response.ok) {
      console.error('[logUsage] Supabase error:', response.status);
    }
  } catch (err: any) {
    console.error('[logUsage] Error:', err);
    // Don't fail the request if logging fails
  }
}

/**
 * Get user statistics from Supabase
 */
export async function getUserStats(
  userId: string,
  env: SupabaseEnv
): Promise<any> {
  try {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/rpc/get_user_statistics`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({ p_user_id: userId }),
      }
    );

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (err: any) {
    console.error('[getUserStats] Error:', err);
    return null;
  }
}
