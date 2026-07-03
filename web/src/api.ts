import type { ApiErrorBody, QuoteRequest, QuoteResponse } from './types';

/**
 * Error thrown for non-200 backend responses, carrying the structured
 * error code/message from the API so the UI can render friendly text.
 */
export class QuoteApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'QuoteApiError';
  }
}

/** Thrown when the backend cannot be reached at all. */
export class BackendUnavailableError extends Error {
  constructor() {
    super('Backend unavailable');
    this.name = 'BackendUnavailableError';
  }
}

/**
 * POST /api/quote - same-origin call; the dev server proxies to the backend,
 * and in production the backend serves this frontend. No API keys involved.
 */
export async function requestQuote(payload: QuoteRequest): Promise<QuoteResponse> {
  let response: Response;
  try {
    response = await fetch('/api/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new BackendUnavailableError();
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON response (e.g. proxy error page)
  }

  if (!response.ok) {
    const errorBody = body as ApiErrorBody | null;
    if (errorBody && errorBody.error && errorBody.error.code) {
      throw new QuoteApiError(errorBody.error.code, errorBody.error.message, errorBody.error.details);
    }
    throw new QuoteApiError('HTTP_ERROR', `Request failed with status ${response.status}`);
  }

  return body as QuoteResponse;
}
