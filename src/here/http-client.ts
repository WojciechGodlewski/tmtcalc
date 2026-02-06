/**
 * HERE API HTTP client with timeout, retry, and error handling
 */

export interface HereClientConfig {
  apiKey: string;
  timeoutMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
}

export interface HereRequestOptions {
  method?: 'GET' | 'POST';
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export class HereApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'HereApiError';
  }
}

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_BACKOFF_MS = 1000;
const MAX_ERROR_BODY_SIZE = 10000; // Limit error body read to 10KB

/**
 * Creates a HERE API HTTP client
 */
export function createHereClient(config: HereClientConfig) {
  const {
    apiKey,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    baseBackoffMs = DEFAULT_BASE_BACKOFF_MS,
  } = config;

  if (!apiKey) {
    throw new Error('HERE API key is required');
  }

  /**
   * Sanitize any occurrence of the API key from a string
   */
  function sanitizeApiKey(message: string): string {
    // Replace API key in URL params format
    let sanitized = message.replace(/apiKey=[^&\s]+/gi, 'apiKey=***');
    // Replace literal occurrences of the API key
    sanitized = sanitized.split(apiKey).join('***');
    return sanitized;
  }

  /**
   * Sleep for a given duration
   */
  async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Check if status code is retryable
   */
  function isRetryable(status: number): boolean {
    return status === 429 || (status >= 500 && status < 600);
  }

  /**
   * Calculate backoff delay with exponential backoff and jitter
   */
  function getBackoffDelay(attempt: number): number {
    const exponentialDelay = baseBackoffMs * Math.pow(2, attempt);
    const jitter = Math.random() * 0.3 * exponentialDelay;
    return exponentialDelay + jitter;
  }

  /**
   * Build URL with query parameters
   */
  function buildUrl(baseUrl: string, params: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(baseUrl);

    // Add API key
    url.searchParams.set('apiKey', apiKey);

    // Add other params
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }

  /**
   * Make HTTP request with timeout
   */
  async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new HereApiError(`Request timeout after ${timeoutMs}ms`, undefined, true);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Build a URL string without the API key for safe logging
   */
  function buildSafeUrlForLogging(baseUrl: string, params: Record<string, string | number | boolean | undefined>): string {
    const safeParams = Object.entries(params)
      .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
      .map(([k, v]) => [k, String(v)] as [string, string]);
    return baseUrl + '?' + new URLSearchParams(safeParams).toString();
  }

  /**
   * Safely read response text with size limit to prevent memory issues
   */
  async function safeReadResponseText(response: Response): Promise<string> {
    try {
      // Check content-length header if available
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_ERROR_BODY_SIZE) {
        // Body too large, read only a portion
        const reader = response.body?.getReader();
        if (!reader) {
          return '[Response body unavailable]';
        }

        const chunks: Uint8Array[] = [];
        let totalSize = 0;

        while (totalSize < MAX_ERROR_BODY_SIZE) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          totalSize += value.length;
        }

        reader.cancel();
        const decoder = new TextDecoder();
        return chunks.map((c) => decoder.decode(c, { stream: true })).join('') + '...[truncated]';
      }

      // Body size is acceptable, read normally
      return await response.text();
    } catch {
      return '[Error reading response body]';
    }
  }

  /**
   * Make request to HERE API with retry logic
   */
  async function request<T>(baseUrl: string, options: HereRequestOptions = {}): Promise<T> {
    const { method = 'GET', params = {}, body } = options;

    // Build URL without exposing API key in errors
    const url = buildUrl(baseUrl, params);
    const safeUrlForLogging = buildSafeUrlForLogging(baseUrl, params);

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const init: RequestInit = {
          method,
          headers: {
            'Accept': 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        };

        const response = await fetchWithTimeout(url, init);

        if (response.ok) {
          return await response.json() as T;
        }

        // Handle error responses
        const isRetryableError = isRetryable(response.status);

        // Safely read error body with size limit
        const rawErrorBody = await safeReadResponseText(response);

        // Try to parse error message from response
        let errorMessage = `HERE API error: ${response.status} ${response.statusText}`;
        try {
          const errorBody = JSON.parse(rawErrorBody) as { error?: string; error_description?: string; message?: string };
          if (errorBody.error_description) {
            errorMessage = `HERE API error: ${errorBody.error_description}`;
          } else if (errorBody.message) {
            errorMessage = `HERE API error: ${errorBody.message}`;
          } else if (errorBody.error) {
            errorMessage = `HERE API error: ${errorBody.error}`;
          }
        } catch {
          // Ignore JSON parse errors, include status and truncated body in message
          errorMessage = `HERE API error: ${response.status} - ${rawErrorBody.slice(0, 200)}`;
        }

        // Debug log: safe URL + first 500 chars of error body (no API key)
        console.error('[HERE API Error] URL:', safeUrlForLogging);
        console.error('[HERE API Error] Status:', response.status);
        console.error('[HERE API Error] Body (first 500 chars):', rawErrorBody.slice(0, 500));

        // Don't leak API key in error messages
        errorMessage = sanitizeApiKey(errorMessage);

        if (isRetryableError && attempt < maxRetries) {
          lastError = new HereApiError(errorMessage, response.status, true);
          const delay = getBackoffDelay(attempt);
          await sleep(delay);
          continue;
        }

        throw new HereApiError(errorMessage, response.status, isRetryableError);
      } catch (error) {
        if (error instanceof HereApiError) {
          if (error.retryable && attempt < maxRetries) {
            lastError = error;
            const delay = getBackoffDelay(attempt);
            await sleep(delay);
            continue;
          }
          throw error;
        }

        // Handle network errors
        const networkError = error instanceof Error ? error.message : 'Unknown error';
        // Don't leak API key
        const safeMessage = sanitizeApiKey(networkError);

        if (attempt < maxRetries) {
          lastError = new HereApiError(`Network error: ${safeMessage}`, undefined, true);
          const delay = getBackoffDelay(attempt);
          await sleep(delay);
          continue;
        }

        throw new HereApiError(
          `HERE API request failed after ${maxRetries + 1} attempts: ${safeMessage}`,
          undefined,
          false
        );
      }
    }

    // Should not reach here, but just in case
    throw lastError || new HereApiError('Request failed', undefined, false);
  }

  return { request };
}

export type HereClient = ReturnType<typeof createHereClient>;
