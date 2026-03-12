/**
 * PiPilot Search API - TypeScript SDK
 *
 * Official client library for the PiPilot Search API
 * https://api.pipilot.dev
 */

export interface PiPilotConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export interface SearchOptions {
  query: string;
  maxResults?: number;
  rerank?: boolean;
  region?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  position: number;
  score?: number;
  rerankReasoning?: string;
}

export interface SearchResponse {
  success: boolean;
  query: string;
  results: SearchResult[];
  count: number;
  cached: boolean;
  reranked: boolean;
  processingTime: string;
}

export interface ExtractOptions {
  url: string;
  format?: 'markdown' | 'text' | 'html';
}

export interface ExtractResponse {
  success: boolean;
  url: string;
  content: string;
  format: string;
  wordCount: number;
  charCount: number;
  cached: boolean;
  processingTime: string;
}

export interface SmartSearchOptions {
  query: string;
  depth?: 'quick' | 'normal' | 'deep';
  maxIterations?: number;
}

export interface SmartSearchResponse {
  success: boolean;
  query: string;
  answer: string;
  sources: Array<{
    type: 'search' | 'extract';
    query?: string;
    url?: string;
  }>;
  steps: Array<{
    iteration: number;
    action: string;
    reasoning: string;
    llmTime: string;
    toolTime?: string;
    resultLength?: number;
  }>;
  iterations: number;
  totalTime: string;
}

export class PiPilot {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;

  constructor(config: PiPilotConfig | string) {
    if (typeof config === 'string') {
      this.apiKey = config;
      this.baseUrl = 'https://api.pipilot.dev';
      this.timeout = 30000;
    } else {
      this.apiKey = config.apiKey;
      this.baseUrl = config.baseUrl || 'https://api.pipilot.dev';
      this.timeout = config.timeout || 30000;
    }
  }

  /**
   * Search the web with AI-powered reranking
   *
   * @example
   * const results = await client.search('AI frameworks 2025');
   * console.log(results.results[0].title);
   */
  async search(
    queryOrOptions: string | SearchOptions
  ): Promise<SearchResponse> {
    const options: SearchOptions = typeof queryOrOptions === 'string'
      ? { query: queryOrOptions }
      : queryOrOptions;

    return this.request<SearchResponse>('/search', {
      method: 'POST',
      body: JSON.stringify(options)
    });
  }

  /**
   * Extract clean content from any URL
   *
   * @example
   * const content = await client.extract('https://example.com/article');
   * console.log(content.content); // Clean markdown
   */
  async extract(
    urlOrOptions: string | ExtractOptions
  ): Promise<ExtractResponse> {
    const options: ExtractOptions = typeof urlOrOptions === 'string'
      ? { url: urlOrOptions }
      : urlOrOptions;

    return this.request<ExtractResponse>('/extract', {
      method: 'POST',
      body: JSON.stringify(options)
    });
  }

  /**
   * Smart search with iterative AI research
   *
   * This endpoint uses AI to iteratively search and extract information
   * until it can provide a comprehensive answer to your question.
   *
   * @example
   * const answer = await client.smartSearch(
   *   'What are the latest quantum computing breakthroughs?'
   * );
   * console.log(answer.answer);
   * console.log('Sources:', answer.sources);
   */
  async smartSearch(
    queryOrOptions: string | SmartSearchOptions
  ): Promise<SmartSearchResponse> {
    const options: SmartSearchOptions = typeof queryOrOptions === 'string'
      ? { query: queryOrOptions }
      : queryOrOptions;

    return this.request<SmartSearchResponse>('/smart-search', {
      method: 'POST',
      body: JSON.stringify(options)
    });
  }

  /**
   * Health check
   */
  async health(): Promise<{ status: string; version: string; timestamp: string }> {
    return this.request('/health', { method: 'GET' });
  }

  /**
   * Internal request handler
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...options.headers
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new PiPilotError(
          error.error || `HTTP ${response.status}`,
          response.status,
          error
        );
      }

      return await response.json();

    } catch (err: any) {
      clearTimeout(timeoutId);

      if (err.name === 'AbortError') {
        throw new PiPilotError('Request timeout', 408);
      }

      if (err instanceof PiPilotError) {
        throw err;
      }

      throw new PiPilotError(err.message, 0, err);
    }
  }
}

/**
 * Custom error class
 */
export class PiPilotError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: any
  ) {
    super(message);
    this.name = 'PiPilotError';
  }
}

/**
 * Default export for convenience
 */
export default PiPilot;
