import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../app.js';
import type { HereService } from '../here/index.js';
import type { HereRoutingResponse } from '../here/route-truck.js';

// Create mock HERE response with toll data for country detection
function createMockRoutingResponse(options: {
  tollCountries?: string[];
  hasTunnel?: boolean;
  tunnelName?: string;
}): HereRoutingResponse {
  const { tollCountries = [], hasTunnel = false, tunnelName } = options;

  const tolls = tollCountries.length > 0
    ? [{
        tolls: tollCountries.map((country) => ({
          countryCode: country,
          tollSystem: 'Test',
          fares: [{ id: 'fare-1', price: { type: 'total', value: '10.00', currency: 'EUR' } }],
        })),
      }]
    : undefined;

  const actions = hasTunnel && tunnelName
    ? [
        { action: 'depart', duration: 0, length: 0, instruction: 'Start', offset: 0 },
        { action: 'continue', duration: 600, length: 10000, instruction: `Enter the ${tunnelName}`, offset: 1 },
      ]
    : [{ action: 'depart', duration: 0, length: 0, instruction: 'Start', offset: 0 }];

  return {
    routes: [
      {
        id: 'mock-route-1',
        sections: [
          {
            id: 'section-1',
            type: 'vehicle',
            departure: {
              time: '2024-01-15T08:00:00+01:00',
              place: { type: 'place', location: { lat: 52.52, lng: 13.405 } },
            },
            arrival: {
              time: '2024-01-15T14:30:00+01:00',
              place: { type: 'place', location: { lat: 45.46, lng: 9.19 } },
            },
            summary: {
              duration: 23400,
              length: 800000, // 800 km
              baseDuration: 21600,
            },
            transport: { mode: 'truck' },
            tolls,
            actions,
          },
        ],
      },
    ],
  };
}

function createMockHereService(
  responseOptions: { tollCountries?: string[]; hasTunnel?: boolean; tunnelName?: string } = {}
): HereService {
  return {
    geocode: vi.fn().mockResolvedValue({
      lat: 52.52,
      lng: 13.405,
      label: 'Berlin, Germany',
      countryCode: 'DEU',
      confidence: 0.95,
    }),
    reverseGeocode: vi.fn().mockResolvedValue({
      countryCode: 'DEU',
      label: 'Berlin, Germany',
    }),
    routeTruck: vi.fn().mockResolvedValue({
      hereResponse: createMockRoutingResponse(responseOptions),
    }),
    clearGeocodeCache: vi.fn(),
    getGeocodeCacheSize: vi.fn().mockReturnValue(0),
  };
}

describe('POST /api/quote', () => {
  describe('validation', () => {
    it('returns 400 for missing vehicleProfileId', async () => {
      const app = buildApp({ hereService: createMockHereService() });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/quote',
        payload: {
          origin: { lat: 52.52, lng: 13.405 },
          destination: { lat: 45.46, lng: 9.19 },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for invalid vehicleProfileId', async () => {
      const app = buildApp({ hereService: createMockHereService() });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/quote',
        payload: {
          origin: { lat: 52.52, lng: 13.405 },
          destination: { lat: 45.46, lng: 9.19 },
          vehicleProfileId: 'invalid',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('successful quotes', () => {
    it('returns quote with pricing breakdown', async () => {
      const mockService = createMockHereService({ tollCountries: ['POL', 'DEU'] });
      const app = buildApp({ hereService: mockService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/quote',
        payload: {
          origin: { lat: 52.52, lng: 13.405 },
          destination: { lat: 50.06, lng: 19.94 },
          vehicleProfileId: 'solo_18t_23ep',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.quote).toBeDefined();
      expect(body.quote.modelId).toBeDefined();
      expect(body.quote.finalPrice).toBeGreaterThan(0);
      expect(body.quote.currency).toBe('EUR');
      expect(body.quote.lineItems).toBeDefined();
      expect(body.quote.lineItems.kmCharge).toBeDefined();
      expect(body.quote.lineItems.emptiesCharge).toBeDefined();
      expect(body.quote.lineItems.surcharges).toBeInstanceOf(Array);
    });

    it('includes routeFacts in response', async () => {
      const mockService = createMockHereService({ tollCountries: ['POL', 'DEU'] });
      const app = buildApp({ hereService: mockService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/quote',
        payload: {
          origin: { lat: 52.52, lng: 13.405 },
          destination: { lat: 50.06, lng: 19.94 },
          vehicleProfileId: 'solo_18t_23ep',
        },
      });

      const body = response.json();

      expect(body.routeFacts).toBeDefined();
      expect(body.routeFacts.route.distanceKm).toBe(800);
      expect(body.routeFacts.raw.provider).toBe('here');
    });

    it('includes debug resolvedPoints', async () => {
      const mockService = createMockHereService({ tollCountries: ['POL', 'DEU'] });
      const app = buildApp({ hereService: mockService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/quote',
        payload: {
          origin: { lat: 52.52, lng: 13.405 },
          destination: { lat: 50.06, lng: 19.94 },
          vehicleProfileId: 'solo_18t_23ep',
        },
      });

      const body = response.json();

      expect(body.debug.resolvedPoints.origin.source).toBe('provided');
      expect(body.debug.resolvedPoints.destination.source).toBe('provided');
    });

    it('accepts pricing options', async () => {
      const mockService = createMockHereService({ tollCountries: ['POL', 'DEU'] });
      const app = buildApp({ hereService: mockService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/quote',
        payload: {
          origin: { lat: 52.52, lng: 13.405 },
          destination: { lat: 50.06, lng: 19.94 },
          vehicleProfileId: 'solo_18t_23ep',
          pricingDateTime: '2024-01-15T10:00:00Z',
          unloadingAfter14: true,
          isWeekend: false,
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('pricing model selection', () => {
    it('uses SOLO PL -> EU model for Poland origin', async () => {
      const mockService = createMockHereService({ tollCountries: ['POL', 'DEU'] });
      const app = buildApp({ hereService: mockService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/quote',
        payload: {
          origin: { lat: 52.23, lng: 21.01 }, // Warsaw
          destination: { lat: 52.52, lng: 13.405 }, // Berlin
          vehicleProfileId: 'solo_18t_23ep',
        },
      });

      const body = response.json();

      expect(body.quote.modelId).toBe('solo-pl-eu');
    });

    it('uses SOLO IT -> EU model for Italy origin', async () => {
      const mockService = createMockHereService({ tollCountries: ['ITA', 'DEU'] });
      const app = buildApp({ hereService: mockService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/quote',
        payload: {
          origin: { lat: 45.46, lng: 9.19 }, // Milan
          destination: { lat: 48.14, lng: 11.58 }, // Munich
          vehicleProfileId: 'solo_18t_23ep',
        },
      });

      const body = response.json();

      expect(body.quote.modelId).toBe('solo-it-eu');
    });

    it('returns 400 when no pricing model matches', async () => {
      // Create a response with unsupported countries
      const mockService = createMockHereService({ tollCountries: ['ESP', 'PRT'] });
      const app = buildApp({ hereService: mockService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/quote',
        payload: {
          origin: { lat: 40.42, lng: -3.70 }, // Madrid
          destination: { lat: 38.72, lng: -9.14 }, // Lisbon
          vehicleProfileId: 'solo_18t_23ep',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('NO_MODEL_AVAILABLE');
    });
  });

  describe('surcharges', () => {
    it('applies tunnel surcharge for Fréjus tunnel', async () => {
      const mockService = createMockHereService({
        tollCountries: ['ITA', 'FRA'],
        hasTunnel: true,
        tunnelName: 'Fréjus Tunnel',
      });
      const app = buildApp({ hereService: mockService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/quote',
        payload: {
          origin: { lat: 45.07, lng: 7.69 }, // Turin
          destination: { lat: 45.76, lng: 4.84 }, // Lyon
          vehicleProfileId: 'solo_18t_23ep',
        },
      });

      const body = response.json();

      expect(body.quote.lineItems.surcharges.some(
        (s: { type: string }) => s.type === 'frejusOrMontBlanc'
      )).toBe(true);
    });
  });

  describe('error handling', () => {
    it('returns 502 when routing fails with upstream error', async () => {
      const mockService = createMockHereService();
      mockService.routeTruck = vi.fn().mockRejectedValue(new Error('Routing failed'));

      const app = buildApp({ hereService: mockService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/quote',
        payload: {
          origin: { lat: 52.52, lng: 13.405 },
          destination: { lat: 45.46, lng: 9.19 },
          vehicleProfileId: 'solo_18t_23ep',
        },
      });

      expect(response.statusCode).toBe(502);
      const body = response.json();
      expect(body.error.code).toBe('UPSTREAM_ERROR');
    });

    it('does not leak API key in error responses', async () => {
      const mockService = createMockHereService();
      mockService.routeTruck = vi.fn().mockRejectedValue(
        new Error('Failed with apiKey=secret123')
      );

      const app = buildApp({ hereService: mockService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/quote',
        payload: {
          origin: { lat: 52.52, lng: 13.405 },
          destination: { lat: 45.46, lng: 9.19 },
          vehicleProfileId: 'solo_18t_23ep',
        },
      });

      const body = response.json();
      expect(body.error.message).not.toContain('secret123');
    });
  });
});
