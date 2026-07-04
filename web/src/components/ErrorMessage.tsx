import { BackendUnavailableError, QuoteApiError } from '../api';

interface ErrorMessageProps {
  error: unknown;
}

/** Map backend error codes / failure modes to operator-friendly messages. */
function describe(error: unknown): { title: string; detail?: string } {
  if (error instanceof BackendUnavailableError) {
    return {
      title: 'Backend unavailable',
      detail: 'Could not reach the TMT Calc API. Make sure the backend is running (npm run dev) and reachable.',
    };
  }

  if (error instanceof QuoteApiError) {
    switch (error.code) {
      case 'NO_MODEL_AVAILABLE':
        return {
          title: 'No pricing model available for this route',
          detail: error.message,
        };
      case 'UPSTREAM_ERROR':
        return {
          title: 'HERE routing service error',
          detail: `The route provider rejected or failed the request. ${error.message}`,
        };
      case 'VALIDATION_ERROR': {
        // Exclusion-related validation errors are already user-friendly -
        // surface them directly as the headline.
        const exclusionMessages = [
          'Origin cannot be in an excluded country.',
          'Destination cannot be in an excluded country.',
        ];
        if (exclusionMessages.includes(error.message) || error.message.startsWith('Unsupported exclude country code')) {
          return { title: error.message };
        }
        return {
          title: 'Invalid request',
          detail: error.message,
        };
      }
      case 'NO_ROUTE_FOUND':
        // Backend message says whether exclusions were involved, e.g.
        // "No route found ... with the selected country exclusions."
        return {
          title: 'No route found',
          detail: error.message,
        };
      case 'TIMEOUT_ERROR':
        return {
          title: 'Request timed out',
          detail: 'The route calculation took too long. Try again.',
        };
      default:
        return { title: 'Request failed', detail: `${error.code}: ${error.message}` };
    }
  }

  if (error instanceof Error) {
    return { title: 'Something went wrong', detail: error.message };
  }

  return { title: 'Something went wrong' };
}

export function ErrorMessage({ error }: ErrorMessageProps) {
  const { title, detail } = describe(error);
  return (
    <div className="card error-card" role="alert">
      <strong>{title}</strong>
      {detail && <p className="error-detail">{detail}</p>}
    </div>
  );
}
