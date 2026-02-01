import Fastify from 'fastify';

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.get('/health', async () => {
    return { ok: true, service: 'tmtcalc' };
  });

  return app;
}
