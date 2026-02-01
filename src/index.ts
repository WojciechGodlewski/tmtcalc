import { buildApp } from './app.js';
import { config } from './config.js';
import { createHereService } from './here/index.js';

/**
 * Sanitize error messages to prevent secret leakage
 */
function sanitizeError(message: string): string {
  return message
    .replace(/apiKey=[^&\s]+/gi, 'apiKey=***')
    .replace(/HERE_API_KEY/gi, '***')
    .replace(/[a-zA-Z0-9_-]{32,}/g, '***'); // Generic long token pattern
}

/**
 * Global error handlers to prevent process crashes
 */
process.on('uncaughtException', (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[FATAL] Uncaught exception:', sanitizeError(message));
  console.error('[FATAL] Stack:', error instanceof Error ? sanitizeError(error.stack || '') : 'No stack');
  // Keep process alive for graceful handling, but log severity
  // In production, you might want to exit after cleanup
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error('[ERROR] Unhandled rejection:', sanitizeError(message));
  if (reason instanceof Error && reason.stack) {
    console.error('[ERROR] Stack:', sanitizeError(reason.stack));
  }
  // Keep process alive - Fastify should handle most rejections
});

// Initialize HERE service if API key is available
let hereService;
if (config.hereApiKey) {
  hereService = createHereService({ apiKey: config.hereApiKey });
  console.log('HERE API service initialized');
} else {
  console.warn('WARNING: HERE_API_KEY not set. /api/route-facts endpoint will not be available.');
}

const app = buildApp({ hereService });

const start = async () => {
  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`Server running at http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
