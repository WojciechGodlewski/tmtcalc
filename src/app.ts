import Fastify from 'fastify';
import type { HereService } from './here/index.js';
import { registerRouteFactsRoutes } from './routes/index.js';

export interface AppOptions {
  hereService?: HereService;
}

export function buildApp(options: AppOptions = {}) {
  const app = Fastify({
    logger: true,
  });

  app.get('/health', async () => {
    return { ok: true, service: 'tmtcalc' };
  });

  // Register API routes if HERE service is available
  if (options.hereService) {
    registerRouteFactsRoutes(app, options.hereService);
  }

  return app;
}
