import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGeocoder } from './geocode.js';
import { createHereClient, HereApiError } from './http-client.js';

// Mock the global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Geocoder', () => {
  const apiKey = 'test-api-key';
  let geocoder: ReturnType<typeof createGeocoder>;

  beforeEach(() => {
    mockFetch.mockReset();
    const client = createHereClient({ apiKey, maxRetries: 0 });
    geocoder = createGeocoder(client);
    geocoder.clearCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockGeocodeResponse = {
    items: [
      {
        title: 'Berlin, Germany',
        id: 'here:pds:place:276u0vhj-12345',
        resultType: 'locality',
        address: {
          label: 'Berlin, Germany',
          countryCode: 'DEU',
          countryName: 'Germany',
          city: 'Berlin',
        },
        position: {
          lat: 52.52,
          lng: 13.405,
        },
        scoring: {
          queryScore: 0.95,
          fieldScore: {
            city: 1.0,
          },
        },
      },
    ],
  };

  describe('geocode', () => {
    it('returns coordinates for a valid address', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockGeocodeResponse,
      });

      const result = await geocoder.geocode('Berlin, Germany');

      expect(result).toEqual({
        lat: 52.52,
        lng: 13.405,
        label: 'Berlin, Germany',
        countryCode: 'DEU',
        confidence: 0.95,
      });
    });

    it('includes countryCodeBias in request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockGeocodeResponse,
      });

      await geocoder.geocode('Berlin', { countryCodeBias: 'DEU' });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.searchParams.get('in')).toBe('countryCode:DEU');
    });

    it('caches results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockGeocodeResponse,
      });

      // First call - should hit API
      await geocoder.geocode('Berlin, Germany');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const result = await geocoder.geocode('Berlin, Germany');
      expect(mockFetch).toHaveBeenCalledTimes(1); // No additional calls
      expect(result.lat).toBe(52.52);
    });

    it('normalizes cache keys (case insensitive)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockGeocodeResponse,
      });

      await geocoder.geocode('Berlin, Germany');
      await geocoder.geocode('BERLIN, GERMANY');
      await geocoder.geocode('  berlin,   germany  ');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('throws error for empty query', async () => {
      await expect(geocoder.geocode('')).rejects.toThrow('Geocode query cannot be empty');
      await expect(geocoder.geocode('   ')).rejects.toThrow('Geocode query cannot be empty');
    });

    it('throws error when no results found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      });

      await expect(geocoder.geocode('xyznonexistent123'))
        .rejects.toThrow('No geocoding results found for: xyznonexistent123');
    });

    it('handles missing countryCode gracefully', async () => {
      const responseWithoutCountry = {
        items: [
          {
            title: 'Some Place',
            id: 'here:pds:place:123',
            resultType: 'locality',
            address: {
              label: 'Some Place',
              // No countryCode
            },
            position: { lat: 10, lng: 20 },
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => responseWithoutCountry,
      });

      const result = await geocoder.geocode('Some Place');
      expect(result.countryCode).toBeNull();
      expect(result.confidence).toBeNull();
    });

    it('propagates API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: 'Unauthorized' }),
      });

      await expect(geocoder.geocode('Berlin')).rejects.toThrow(HereApiError);
    });
  });

  describe('reverseGeocode normalization', () => {
    it('normalizes address components (city/district/county/state/street)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              title: 'Brennero',
              id: 'here:1',
              resultType: 'street',
              address: {
                label: 'Brennero, Trentino-South Tyrol, Italy',
                countryCode: 'ITA',
                city: 'Brennero',
                county: 'Bolzano',
                state: 'Trentino-South Tyrol',
                street: 'A22',
              },
              position: { lat: 46.885, lng: 11.375 },
            },
          ],
        }),
      });

      const result = await geocoder.reverseGeocode(46.885, 11.375);
      expect(result.label).toBe('Brennero, Trentino-South Tyrol, Italy');
      expect(result.countryCode).toBe('ITA');
      expect(result.city).toBe('Brennero');
      expect(result.county).toBe('Bolzano');
      expect(result.state).toBe('Trentino-South Tyrol');
      expect(result.street).toBe('A22');
      expect(result.district).toBeNull();
    });

    it('returns nulls for missing components without crashing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              title: 'Somewhere',
              id: 'here:2',
              resultType: 'locality',
              address: { label: 'Somewhere' },
              position: { lat: 1, lng: 2 },
            },
          ],
        }),
      });

      const result = await geocoder.reverseGeocode(1, 2);
      expect(result.label).toBe('Somewhere');
      expect(result.countryCode).toBeNull();
      expect(result.city).toBeNull();
      expect(result.state).toBeNull();
    });
  });

  describe('cache management', () => {
    it('reports cache size correctly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockGeocodeResponse,
      });

      expect(geocoder.getCacheSize()).toBe(0);

      await geocoder.geocode('Berlin');
      expect(geocoder.getCacheSize()).toBe(1);

      await geocoder.geocode('Munich');
      expect(geocoder.getCacheSize()).toBe(2);
    });

    it('clears cache', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockGeocodeResponse,
      });

      await geocoder.geocode('Berlin');
      expect(geocoder.getCacheSize()).toBe(1);

      geocoder.clearCache();
      expect(geocoder.getCacheSize()).toBe(0);
    });
  });
});
