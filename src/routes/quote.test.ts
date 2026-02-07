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
  responseOptions: {
    tollCountries?: string[];
    hasTunnel?: boolean;
    tunnelName?: string;
    originCountry?: string;
    destinationCountry?: string;
  } = {}
): HereService {
  const {
    originCountry = 'DEU',
    destinationCountry = 'DEU',
    hasTunnel = false,
    tunnelName,
  } = responseOptions;

  const mockResponse = createMockRoutingResponse(responseOptions);
  const samples: string[] = [];
  if (mockResponse.routes[0]?.sections[0]?.actions) {
    for (const action of mockResponse.routes[0].sections[0].actions) {
      if (action.instruction) {
        samples.push(`action:instruction:${action.instruction}`);
      }
    }
  }

  return {
    geocode: vi.fn().mockResolvedValue({
      lat: 52.52,
      lng: 13.405,
      label: 'Berlin, Germany',
      countryCode: originCountry,
      confidence: 0.95,
    }),
    reverseGeocode: vi.fn()
      .mockResolvedValueOnce({ countryCode: originCountry, label: 'Origin' })
      .mockResolvedValueOnce({ countryCode: destinationCountry, label: 'Destination' }),
    routeTruck: vi.fn().mockResolvedValue({
      hereResponse: mockResponse,
      debug: {
        maskedUrl: 'https://router.hereapi.com/v8/routes?transportMode=truck&origin=52.52,13.405&destination=45.46,9.19',
        via: [],
        viaCount: 0,
        sectionsCount: 1,
        actionsCountTotal: mockResponse.routes[0]?.sections[0]?.actions?.length ?? 0,
        polylinePointsChecked: 0,
        alpsMatch: { frejus: false, montBlanc: false },
        alpsMatchDetails: {
          frejus: { matched: false, pointsInside: 0 },
          montBlanc: { matched: false, pointsInside: 0 },
        },
        alpsConfig: {
          centers: {
            frejus: { lat: 45.086, lng: 6.706 },
            montBlanc: { lat: 45.924, lng: 6.968 },
          },
          bboxes: {
            frejus: { minLat: 45.03, maxLat: 45.17, minLng: 6.60, maxLng: 6.78 },
            montBlanc: { minLat: 45.82, maxLat: 45.96, minLng: 6.92, maxLng: 7.03 },
          },
        },
        alpsCenterDistances: {
          frejus: { fromOrigin: 1000, fromWaypoints: [], fromDestination: 1200 },
          montBlanc: { fromOrigin: 950, fromWaypoints: [], fromDestination: 1100 },
        },
        polylineSanity: {
          polylineBounds: null,
          polylineFirstPoint: null,
          polylineLastPoint: null,
          pointCount: 0,
        },
        samples,
      },
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
      // Use PL origin to match the solo-pl-eu model
      const mockService = createMockHereService({
        tollCountries: ['POL', 'DEU'],
        originCountry: 'POL',
        destinationCountry: 'DEU',
      });
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
      const mockService = createMockHereService({
        tollCountries: ['POL', 'DEU'],
        originCountry: 'POL',
        destinationCountry: 'DEU',
      });
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

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.routeFacts).toBeDefined();
      expect(body.routeFacts.route.distanceKm).toBe(800);
      expect(body.routeFacts.raw.provider).toBe('here');
    });

    it('includes debug resolvedPoints', async () => {
      const mockService = createMockHereService({
        tollCountries: ['POL', 'DEU'],
        originCountry: 'POL',
        destinationCountry: 'DEU',
      });
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

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.debug.resolvedPoints.origin.source).toBe('provided');
      expect(body.debug.resolvedPoints.destination.source).toBe('provided');
    });

    it('accepts pricing options', async () => {
      const mockService = createMockHereService({
        tollCountries: ['POL', 'DEU'],
        originCountry: 'POL',
        destinationCountry: 'DEU',
      });
      const app = buildApp({ hereService: mockService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/quote',
        payload: {
          origin: { lat: 52.23, lng: 21.01 }, // Warsaw
          destination: { lat: 52.52, lng: 13.405 }, // Berlin
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
      const mockService = createMockHereService({
        tollCountries: ['POL', 'DEU'],
        originCountry: 'POL',
        destinationCountry: 'DEU',
      });
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

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.quote.modelId).toBe('solo-pl-eu');
      // Verify country codes are in routeFacts (normalized to alpha-2)
      expect(body.routeFacts.geography.originCountry).toBe('PL');
      expect(body.routeFacts.geography.destinationCountry).toBe('DE');
    });

    it('uses SOLO IT -> EU model for Italy origin', async () => {
      const mockService = createMockHereService({
        tollCountries: ['ITA', 'DEU'],
        originCountry: 'ITA',
        destinationCountry: 'DEU',
      });
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

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.quote.modelId).toBe('solo-it-eu');
      // Verify country codes are in routeFacts (normalized to alpha-2)
      expect(body.routeFacts.geography.originCountry).toBe('IT');
      expect(body.routeFacts.geography.destinationCountry).toBe('DE');
    });

    it('returns 400 when no pricing model matches and shows actual countries', async () => {
      // Create a response with unsupported countries (Spain -> Portugal)
      // No model exists for ES -> PT for solo_18t_23ep
      const mockService = createMockHereService({
        tollCountries: ['ESP', 'PRT'],
        originCountry: 'ESP',
        destinationCountry: 'PRT',
      });
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
      // Error message should contain actual countries (alpha-2), not "unknown"
      expect(body.error.message).toContain('ES');
      expect(body.error.message).toContain('PT');
      expect(body.error.message).not.toContain('unknown');
    });
  });

  describe('surcharges', () => {
    it('does not apply tunnel surcharge without polyline geofencing', async () => {
      // Even with tunnel mention in action text, Alps surcharge requires polyline geofencing
      const mockService = createMockHereService({
        tollCountries: ['ITA', 'FRA'],
        hasTunnel: true,
        tunnelName: 'Fréjus Tunnel',
        originCountry: 'ITA',
        destinationCountry: 'FRA',
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

      expect(response.statusCode).toBe(200);
      const body = response.json();

      // Alps surcharge is NOT applied because crossesAlps requires polyline geofencing
      // Action text alone is not sufficient for surcharge triggering
      expect(body.quote.lineItems.surcharges.some(
        (s: { type: string }) => s.type === 'alpsTunnel'
      )).toBe(false);
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

  describe('Alps debug config propagation', () => {
    it('includes alpsConfig at top level of debug', async () => {
      // Use PL origin (Poland) which has a pricing model for EU destinations
      const mockService = createMockHereService('PL', 'IT');
      // Override geocode to return proper country codes for addresses
      mockService.geocode = vi.fn()
        .mockResolvedValueOnce({ lat: 52.23, lng: 21.01, label: 'Warsaw, Poland', countryCode: 'PL' })
        .mockResolvedValueOnce({ lat: 45.46, lng: 9.19, label: 'Milan, Italy', countryCode: 'IT' });

      const app = buildApp({ hereService: mockService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/quote',
        payload: {
          origin: { address: 'Warsaw, Poland' },
          destination: { address: 'Milan, Italy' },
          vehicleProfileId: 'solo_18t_23ep',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      // alpsConfig should be at top level of debug
      expect(body.debug.alpsConfig).toBeDefined();
      expect(body.debug.alpsConfig.centers).toBeDefined();
      expect(body.debug.alpsConfig.centers.frejus).toBeDefined();
      expect(typeof body.debug.alpsConfig.centers.frejus.lat).toBe('number');
      expect(body.debug.alpsConfig.bboxes).toBeDefined();
    });

    it('includes alpsCenterDistances at top level of debug', async () => {
      // Use PL origin (Poland) which has a pricing model for EU destinations
      const mockService = createMockHereService('PL', 'IT');
      // Override geocode to return proper country codes for addresses
      mockService.geocode = vi.fn()
        .mockResolvedValueOnce({ lat: 52.23, lng: 21.01, label: 'Warsaw, Poland', countryCode: 'PL' })
        .mockResolvedValueOnce({ lat: 45.46, lng: 9.19, label: 'Milan, Italy', countryCode: 'IT' });

      const app = buildApp({ hereService: mockService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/quote',
        payload: {
          origin: { address: 'Warsaw, Poland' },
          destination: { address: 'Milan, Italy' },
          vehicleProfileId: 'solo_18t_23ep',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      // alpsCenterDistances should be at top level of debug
      expect(body.debug.alpsCenterDistances).toBeDefined();
      expect(body.debug.alpsCenterDistances.frejus).toBeDefined();
      expect(typeof body.debug.alpsCenterDistances.frejus.fromOrigin).toBe('number');
      expect(Array.isArray(body.debug.alpsCenterDistances.frejus.fromWaypoints)).toBe(true);
    });
  });
});
