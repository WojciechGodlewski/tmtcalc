import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../app.js';
import type { HereService } from '../here/index.js';
import type { HereRoutingResponse } from '../here/route-truck.js';

// Mock HERE service
function createMockHereService(): HereService {
  const mockRoutingResponse: HereRoutingResponse = {
    routes: [
      {
        id: 'mock-route-1',
        sections: [
          {
            id: 'section-1',
            type: 'vehicle',
            departure: {
              time: '2024-01-15T08:00:00+01:00',
              place: {
                type: 'place',
                location: { lat: 52.52, lng: 13.405 },
              },
            },
            arrival: {
              time: '2024-01-15T14:30:00+01:00',
              place: {
                type: 'place',
                location: { lat: 52.2297, lng: 21.0122 },
              },
            },
            summary: {
              duration: 23400,
              length: 574000,
              baseDuration: 21600,
            },
            transport: { mode: 'truck' },
          },
        ],
      },
    ],
  };

  return {
    geocode: vi.fn().mockResolvedValue({
      lat: 52.52,
      lng: 13.405,
      label: 'Berlin, Germany',
      countryCode: 'DEU',
      confidence: 0.95,
    }),
    routeTruck: vi.fn().mockResolvedValue({
      hereResponse: mockRoutingResponse,
    }),
    clearGeocodeCache: vi.fn(),
    getGeocodeCacheSize: vi.fn().mockReturnValue(0),
  };
}

describe('POST /api/route-facts', () => {
  let mockHereService: HereService;

  beforeEach(() => {
    mockHereService = createMockHereService();
  });

  describe('validation', () => {
    it('returns 400 for missing body', async () => {
      const app = buildApp({ hereService: mockHereService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBe('Invalid request body');
    });

    it('returns 400 for missing origin', async () => {
      const app = buildApp({ hereService: mockHereService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {
          destination: { lat: 52.2297, lng: 21.0122 },
          vehicleProfileId: 'ftl_13_6_33ep',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for missing destination', async () => {
      const app = buildApp({ hereService: mockHereService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {
          origin: { lat: 52.52, lng: 13.405 },
          vehicleProfileId: 'ftl_13_6_33ep',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for missing vehicleProfileId', async () => {
      const app = buildApp({ hereService: mockHereService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {
          origin: { lat: 52.52, lng: 13.405 },
          destination: { lat: 52.2297, lng: 21.0122 },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for invalid vehicleProfileId', async () => {
      const app = buildApp({ hereService: mockHereService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {
          origin: { lat: 52.52, lng: 13.405 },
          destination: { lat: 52.2297, lng: 21.0122 },
          vehicleProfileId: 'invalid_profile',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for location without address or coordinates', async () => {
      const app = buildApp({ hereService: mockHereService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {
          origin: {},
          destination: { lat: 52.2297, lng: 21.0122 },
          vehicleProfileId: 'ftl_13_6_33ep',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for location with only lat (missing lng)', async () => {
      const app = buildApp({ hereService: mockHereService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {
          origin: { lat: 52.52 },
          destination: { lat: 52.2297, lng: 21.0122 },
          vehicleProfileId: 'ftl_13_6_33ep',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for invalid latitude', async () => {
      const app = buildApp({ hereService: mockHereService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {
          origin: { lat: 999, lng: 13.405 },
          destination: { lat: 52.2297, lng: 21.0122 },
          vehicleProfileId: 'ftl_13_6_33ep',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('successful requests', () => {
    it('returns route facts for coordinates', async () => {
      const app = buildApp({ hereService: mockHereService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {
          origin: { lat: 52.52, lng: 13.405 },
          destination: { lat: 52.2297, lng: 21.0122 },
          vehicleProfileId: 'ftl_13_6_33ep',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.routeFacts).toBeDefined();
      expect(body.routeFacts.route.distanceKm).toBe(574);
      expect(body.routeFacts.raw.provider).toBe('here');

      expect(body.debug.resolvedPoints.origin.source).toBe('provided');
      expect(body.debug.resolvedPoints.destination.source).toBe('provided');
    });

    it('geocodes address when provided', async () => {
      const app = buildApp({ hereService: mockHereService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {
          origin: { address: 'Berlin, Germany' },
          destination: { lat: 52.2297, lng: 21.0122 },
          vehicleProfileId: 'van_8ep',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(mockHereService.geocode).toHaveBeenCalledWith('Berlin, Germany');
      expect(body.debug.resolvedPoints.origin.source).toBe('geocoded');
      expect(body.debug.resolvedPoints.origin.label).toBe('Berlin, Germany');
    });

    it('handles waypoints', async () => {
      const app = buildApp({ hereService: mockHereService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {
          origin: { lat: 52.52, lng: 13.405 },
          destination: { lat: 52.2297, lng: 21.0122 },
          waypoints: [
            { lat: 51.5, lng: 14.5 },
            { address: 'Poznan, Poland' },
          ],
          vehicleProfileId: 'solo_18t_23ep',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.debug.resolvedPoints.waypoints).toHaveLength(2);
      expect(body.debug.resolvedPoints.waypoints[0].source).toBe('provided');
      expect(body.debug.resolvedPoints.waypoints[1].source).toBe('geocoded');
    });

    it('calls routeTruck with correct parameters', async () => {
      const app = buildApp({ hereService: mockHereService });
      await app.ready();

      await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {
          origin: { lat: 52.52, lng: 13.405 },
          destination: { lat: 52.2297, lng: 21.0122 },
          vehicleProfileId: 'ftl_13_6_33ep',
        },
      });

      expect(mockHereService.routeTruck).toHaveBeenCalledWith({
        origin: { lat: 52.52, lng: 13.405 },
        destination: { lat: 52.2297, lng: 21.0122 },
        waypoints: undefined,
        vehicleProfileId: 'ftl_13_6_33ep',
      });
    });
  });

  describe('error handling', () => {
    it('returns 500 when geocoding fails', async () => {
      mockHereService.geocode = vi.fn().mockRejectedValue(new Error('Geocoding failed'));

      const app = buildApp({ hereService: mockHereService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {
          origin: { address: 'Invalid Address XYZ123' },
          destination: { lat: 52.2297, lng: 21.0122 },
          vehicleProfileId: 'ftl_13_6_33ep',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.error).toBe('Failed to calculate route');
    });

    it('returns 500 when routing fails', async () => {
      mockHereService.routeTruck = vi.fn().mockRejectedValue(new Error('Routing failed'));

      const app = buildApp({ hereService: mockHereService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {
          origin: { lat: 52.52, lng: 13.405 },
          destination: { lat: 52.2297, lng: 21.0122 },
          vehicleProfileId: 'ftl_13_6_33ep',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.error).toBe('Failed to calculate route');
    });

    it('does not leak API key in error messages', async () => {
      mockHereService.routeTruck = vi.fn().mockRejectedValue(
        new Error('Request failed: apiKey=secret123&param=value')
      );

      const app = buildApp({ hereService: mockHereService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {
          origin: { lat: 52.52, lng: 13.405 },
          destination: { lat: 52.2297, lng: 21.0122 },
          vehicleProfileId: 'ftl_13_6_33ep',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.details).not.toContain('secret123');
      expect(body.details).toContain('apiKey=***');
    });
  });

  describe('endpoint not registered', () => {
    it('returns 404 when hereService is not provided', async () => {
      const app = buildApp(); // No hereService
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {
          origin: { lat: 52.52, lng: 13.405 },
          destination: { lat: 52.2297, lng: 21.0122 },
          vehicleProfileId: 'ftl_13_6_33ep',
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
