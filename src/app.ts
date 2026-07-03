import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { HereService } from './here/index.js';
import { registerRouteFactsRoutes, registerQuoteRoutes } from './routes/index.js';
import { ApiError, toApiError, sanitizeErrorMessage } from './errors.js';

// Request timeout in milliseconds (30 seconds)
const REQUEST_TIMEOUT_MS = 30000;

// Built frontend location: <repo>/web/dist. Resolves correctly both when
// running from src/ (tsx) and from the compiled dist/ output.
const WEB_DIST_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../web/dist'
);

export interface AppOptions {
  hereService?: HereService;
  requestTimeoutMs?: number;
  /** Serve the built frontend from web/dist if present (default true) */
  serveFrontend?: boolean;
}

export function buildApp(options: AppOptions = {}) {
  const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;

  const app = Fastify({
    logger: true,
    // Set connection timeout to prevent socket hang up
    connectionTimeout: timeoutMs,
    // Disable request timeout here, we handle it in the hook
    requestTimeout: 0,
  });

  /**
   * Add request timeout hook
   */
  app.addHook('onRequest', async (request, reply) => {
    const timeoutId = setTimeout(() => {
      if (!reply.sent) {
        request.log.error('Request timeout');
        reply.status(504).send({
          error: {
            code: 'TIMEOUT_ERROR',
            message: 'Request timed out',
          },
        });
      }
    }, timeoutMs);

    // Clean up timeout when request completes
    reply.raw.on('close', () => clearTimeout(timeoutId));
  });

  /**
   * Global error handler for unhandled errors in routes
   */
  app.setErrorHandler((error, request, reply) => {
    // Log the error (sanitized)
    const sanitizedMessage = sanitizeErrorMessage(error.message || 'Unknown error');
    request.log.error({ error: sanitizedMessage, stack: error.stack }, 'Unhandled route error');

    // Convert to ApiError for consistent response
    const apiError = toApiError(error);

    // Send standardized error response
    reply.status(apiError.statusCode).send(apiError.toResponse());
  });

  app.get('/health', async () => {
    return { ok: true, service: 'tmtcalc' };
  });

  // Register API routes if HERE service is available
  if (options.hereService) {
    registerRouteFactsRoutes(app, options.hereService);
    registerQuoteRoutes(app, options.hereService);
  }

  // Serve the built frontend (web/dist) when it exists, so a production
  // deployment is a single process: same origin for UI and API, no CORS.
  if ((options.serveFrontend ?? true) && existsSync(WEB_DIST_DIR)) {
    app.register(fastifyStatic, { root: WEB_DIST_DIR });
  }

  return app;
}
