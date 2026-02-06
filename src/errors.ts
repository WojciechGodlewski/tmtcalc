/**
 * Standardized API error types and utilities
 */

/**
 * Error codes for API responses
 */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL_ERROR'
  | 'TIMEOUT_ERROR'
  | 'NOT_FOUND'
  | 'NO_MODEL_AVAILABLE';

/**
 * Standardized error response structure
 */
export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

/**
 * Custom API error class for controlled error responses
 */
export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /**
   * Convert to standardized response format
   */
  toResponse(): ApiErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

/**
 * Sanitize error messages to prevent secret leakage
 */
export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/apiKey=[^&\s]+/gi, 'apiKey=***')
    .replace(/HERE_API_KEY/gi, '***')
    .replace(/[a-zA-Z0-9_-]{32,}/g, '***'); // Generic long token pattern
}

/**
 * Check if an error is from an upstream service (HERE API)
 */
export function isUpstreamError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.name === 'HereApiError' ||
      error.message.includes('HERE API') ||
      error.message.includes('Geocoding failed') ||
      error.message.includes('Routing failed')
    );
  }
  return false;
}

/**
 * Convert any error to a standardized ApiError
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  const sanitizedMessage = sanitizeErrorMessage(message);

  // Check for specific error types
  if (message.includes('No pricing model found')) {
    return new ApiError('NO_MODEL_AVAILABLE', sanitizedMessage, 400);
  }

  if (isUpstreamError(error)) {
    return new ApiError('UPSTREAM_ERROR', sanitizedMessage, 502);
  }

  if (message.includes('timeout') || message.includes('Timeout')) {
    return new ApiError('TIMEOUT_ERROR', sanitizedMessage, 504);
  }

  return new ApiError('INTERNAL_ERROR', sanitizedMessage, 500);
}
