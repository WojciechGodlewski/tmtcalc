import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHereClient, HereApiError } from './http-client.js';

// Mock the global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('HereClient', () => {
  const apiKey = 'test-api-key';

  beforeEach(() => {
    mockFetch.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('createHereClient', () => {
    it('throws error when API key is missing', () => {
      expect(() => createHereClient({ apiKey: '' })).toThrow('HERE API key is required');
    });

    it('creates client with valid API key', () => {
      const client = createHereClient({ apiKey });
      expect(client).toBeDefined();
      expect(client.request).toBeDefined();
    });
  });

  describe('request', () => {
    it('includes API key in request URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: 'test' }),
      });

      const client = createHereClient({ apiKey });
      await client.request('https://api.here.com/test');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.searchParams.get('apiKey')).toBe(apiKey);
    });

    it('adds custom params to request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: 'test' }),
      });

      const client = createHereClient({ apiKey });
      await client.request('https://api.here.com/test', {
        params: { foo: 'bar', num: 123 },
      });

      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.searchParams.get('foo')).toBe('bar');
      expect(url.searchParams.get('num')).toBe('123');
    });

    it('returns parsed JSON response', async () => {
      const responseData = { items: [{ id: 1 }, { id: 2 }] };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => responseData,
      });

      const client = createHereClient({ apiKey });
      const result = await client.request('https://api.here.com/test');

      expect(result).toEqual(responseData);
    });

    it('throws HereApiError on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: 'Invalid API key' }),
      });

      const client = createHereClient({ apiKey, maxRetries: 0 });

      await expect(client.request('https://api.here.com/test'))
        .rejects.toThrow(HereApiError);
    });

    it('does not leak API key in error messages', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: `Invalid key: ${apiKey}` }),
      });

      const client = createHereClient({ apiKey, maxRetries: 0 });

      try {
        await client.request('https://api.here.com/test');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(HereApiError);
        expect((error as Error).message).not.toContain(apiKey);
      }
    });

    it('retries on 429 rate limit', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          json: async () => ({ error: 'Rate limit exceeded' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

      const client = createHereClient({ apiKey, maxRetries: 3, baseBackoffMs: 100 });

      const promise = client.request('https://api.here.com/test');

      // Fast-forward through the backoff delay
      await vi.advanceTimersByTimeAsync(200);

      const result = await promise;
      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retries on 5xx server errors', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          json: async () => ({ error: 'Service temporarily unavailable' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

      const client = createHereClient({ apiKey, maxRetries: 3, baseBackoffMs: 100 });

      const promise = client.request('https://api.here.com/test');
      await vi.advanceTimersByTimeAsync(200);

      const result = await promise;
      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does not retry on 4xx client errors (except 429)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: 'Invalid parameters' }),
      });

      const client = createHereClient({ apiKey, maxRetries: 3 });

      await expect(client.request('https://api.here.com/test'))
        .rejects.toThrow(HereApiError);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('gives up after max retries', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({ error: 'Service unavailable' }),
      });

      const client = createHereClient({ apiKey, maxRetries: 2, baseBackoffMs: 100 });

      let caughtError: Error | undefined;
      const promise = client.request('https://api.here.com/test').catch((err) => {
        caughtError = err;
      });

      // Fast-forward through all retries
      await vi.advanceTimersByTimeAsync(2000);
      await promise;

      expect(caughtError).toBeInstanceOf(HereApiError);
      expect(mockFetch).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });
  });
});
