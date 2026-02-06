import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from './app.js';

describe('Health endpoint', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      service: 'tmtcalc',
    });
  });
});
