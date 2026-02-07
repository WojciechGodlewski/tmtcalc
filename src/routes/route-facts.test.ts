import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../app.js';
import type { HereService } from '../here/index.js';
import type { HereRoutingResponse } from '../here/route-truck.js';
import { HereApiError } from '../here/http-client.js';

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
            actions: [
              {
                action: 'depart',
                duration: 0,
                length: 0,
                instruction: 'Head east on A115',
                offset: 0,
              },
            ],
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
    reverseGeocode: vi.fn().mockResolvedValue({
      countryCode: 'DEU',
      label: 'Berlin, Germany',
    }),
    routeTruck: vi.fn().mockResolvedValue({
      hereResponse: mockRoutingResponse,
      debug: {
        maskedUrl: 'https://router.hereapi.com/v8/routes?transportMode=truck&origin=52.52,13.405&destination=52.2297,21.0122',
        via: [],
        viaCount: 0,
        sectionsCount: 1,
        actionsCountTotal: 1,
        polylinePointsChecked: 0,
        alpsMatch: { frejus: false, montBlanc: false },
        alpsMatchDetails: {
          frejus: { matched: false, pointsInside: 0, matchReason: 'none' },
          montBlanc: { matched: false, pointsInside: 0, matchReason: 'none' },
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
        waypointProximity: {
          frejus: false,
          montBlanc: false,
          reasons: { frejus: 'none', montBlanc: 'none' },
        },
        polylineBoundsPlausible: false,
        alpsMatchReason: { frejus: 'none', montBlanc: 'none' },
        samples: ['action:instruction:Head east on A115'],
      },
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
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe('Invalid request body');
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
    it('returns 502 when geocoding fails with upstream error', async () => {
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

      expect(response.statusCode).toBe(502);
      const body = response.json();
      expect(body.error.code).toBe('UPSTREAM_ERROR');
      expect(body.error.message).toContain('Geocoding failed');
    });

    it('returns 502 when routing fails with upstream error', async () => {
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

      expect(response.statusCode).toBe(502);
      const body = response.json();
      expect(body.error.code).toBe('UPSTREAM_ERROR');
      expect(body.error.message).toContain('Routing failed');
    });

    it('returns 502 when HERE API throws HereApiError', async () => {
      mockHereService.routeTruck = vi.fn().mockRejectedValue(
        new HereApiError('HERE API error: Bad Request', 400)
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

      // Upstream errors return 502
      expect(response.statusCode).toBe(502);
      const body = response.json();
      expect(body.error.code).toBe('UPSTREAM_ERROR');
      expect(body.error.message).toContain('HERE API error');
    });

    it('does not leak API key in error messages', async () => {
      mockHereService.routeTruck = vi.fn().mockRejectedValue(
        new HereApiError('Request failed: apiKey=secret123&param=value', 500)
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

      expect(response.statusCode).toBe(502);
      const body = response.json();
      expect(body.error.message).not.toContain('secret123');
      expect(body.error.message).toContain('apiKey=***');
    });

    it('returns JSON error response (no socket hang up) on unexpected errors', async () => {
      mockHereService.routeTruck = vi.fn().mockRejectedValue(
        new Error('Unexpected internal error')
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

      // Should not hang up - should return proper JSON error
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      const body = response.json();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBeDefined();
      expect(body.error.message).toBeDefined();
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

  describe('waypoint propagation debug telemetry', () => {
    it('includes hereRequest debug info with viaCount and maskedUrl', async () => {
      // Configure mock to return debug info with via points
      mockHereService.routeTruck = vi.fn().mockResolvedValue({
        hereResponse: {
          routes: [{
            id: 'mock-route-1',
            sections: [{
              id: 'section-1',
              type: 'vehicle',
              departure: { time: '2024-01-15T08:00:00+01:00', place: { type: 'place', location: { lat: 45.0703, lng: 7.6869 } } },
              arrival: { time: '2024-01-15T14:30:00+01:00', place: { type: 'place', location: { lat: 45.5646, lng: 5.9178 } } },
              summary: { duration: 23400, length: 150000, baseDuration: 21600 },
              transport: { mode: 'truck' },
              actions: [{ action: 'depart', duration: 0, length: 0, instruction: 'Head west on A32', offset: 0 }],
            }],
          }],
        },
        debug: {
          maskedUrl: 'https://router.hereapi.com/v8/routes?transportMode=truck&origin=45.0703,7.6869&destination=45.5646,5.9178&via=45.0505%2C6.7333!passThrough%3Dtrue',
          via: [{ lat: 45.0505, lng: 6.7333 }],
          viaCount: 1,
          sectionsCount: 1,
          actionsCountTotal: 1,
          polylinePointsChecked: 0,
          alpsMatch: { frejus: false, montBlanc: false },
          alpsMatchDetails: {
            frejus: { matched: false, pointsInside: 0, matchReason: 'none' },
            montBlanc: { matched: false, pointsInside: 0, matchReason: 'none' },
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
            frejus: { fromOrigin: 70, fromWaypoints: [1.5], fromDestination: 82 },
            montBlanc: { fromOrigin: 100, fromWaypoints: [95], fromDestination: 50 },
          },
          polylineSanity: {
            polylineBounds: null,
            polylineFirstPoint: null,
            polylineLastPoint: null,
            pointCount: 0,
          },
          waypointProximity: {
            frejus: true,
            montBlanc: false,
            reasons: { frejus: 'waypointProximity', montBlanc: 'none' },
          },
          polylineBoundsPlausible: false,
          alpsMatchReason: { frejus: 'waypointProximity', montBlanc: 'none' },
          samples: ['action:instruction:Head west on A32'],
        },
      });

      const app = buildApp({ hereService: mockHereService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {
          origin: { address: 'Turin, Italy' },
          destination: { address: 'Chambéry, France' },
          waypoints: [{ address: 'Bardonecchia, Italy' }],
          vehicleProfileId: 'solo_18t_23ep',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      // Verify hereRequest debug info
      expect(body.debug.hereRequest).toBeDefined();
      expect(body.debug.hereRequest.viaCount).toBe(1);
      expect(body.debug.hereRequest.via).toHaveLength(1);
      expect(body.debug.hereRequest.maskedUrl).toContain('via=');

      // Verify hereResponse debug info
      expect(body.debug.hereResponse).toBeDefined();
      expect(body.debug.hereResponse.sectionsCount).toBe(1);
      expect(body.debug.hereResponse.actionsCountTotal).toBe(1);
      expect(body.debug.hereResponse.polylinePointsChecked).toBe(0);
      expect(body.debug.hereResponse.alpsMatch).toEqual({ frejus: false, montBlanc: false });
      expect(body.debug.hereResponse.samples).toBeDefined();
      expect(Array.isArray(body.debug.hereResponse.samples)).toBe(true);
    });

    it('accepts via as an alias for waypoints', async () => {
      mockHereService.routeTruck = vi.fn().mockResolvedValue({
        hereResponse: {
          routes: [{
            id: 'mock-route-1',
            sections: [{
              id: 'section-1',
              type: 'vehicle',
              departure: { time: '2024-01-15T08:00:00+01:00', place: { type: 'place', location: { lat: 52.52, lng: 13.405 } } },
              arrival: { time: '2024-01-15T14:30:00+01:00', place: { type: 'place', location: { lat: 52.2297, lng: 21.0122 } } },
              summary: { duration: 23400, length: 574000, baseDuration: 21600 },
              transport: { mode: 'truck' },
            }],
          }],
        },
        debug: {
          maskedUrl: 'https://router.hereapi.com/v8/routes?via=51.5%2C14.5!passThrough%3Dtrue',
          via: [{ lat: 51.5, lng: 14.5 }],
          viaCount: 1,
          sectionsCount: 1,
          actionsCountTotal: 0,
          polylinePointsChecked: 0,
          alpsMatch: { frejus: false, montBlanc: false },
          alpsMatchDetails: {
            frejus: { matched: false, pointsInside: 0, matchReason: 'none' },
            montBlanc: { matched: false, pointsInside: 0, matchReason: 'none' },
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
            frejus: { fromOrigin: 1000, fromWaypoints: [900], fromDestination: 1200 },
            montBlanc: { fromOrigin: 950, fromWaypoints: [850], fromDestination: 1100 },
          },
          polylineSanity: {
            polylineBounds: null,
            polylineFirstPoint: null,
            polylineLastPoint: null,
            pointCount: 0,
          },
          waypointProximity: {
            frejus: false,
            montBlanc: false,
            reasons: { frejus: 'none', montBlanc: 'none' },
          },
          polylineBoundsPlausible: false,
          alpsMatchReason: { frejus: 'none', montBlanc: 'none' },
          samples: [],
        },
      });

      const app = buildApp({ hereService: mockHereService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {
          origin: { lat: 52.52, lng: 13.405 },
          destination: { lat: 52.2297, lng: 21.0122 },
          via: [{ lat: 51.5, lng: 14.5 }],  // Using 'via' instead of 'waypoints'
          vehicleProfileId: 'ftl_13_6_33ep',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      // routeTruck should have been called with waypoints (internal canonical name)
      expect(mockHereService.routeTruck).toHaveBeenCalledWith(
        expect.objectContaining({
          waypoints: [{ lat: 51.5, lng: 14.5 }],
        })
      );

      // Verify debug shows via points
      expect(body.debug.hereRequest.viaCount).toBe(1);
    });

    it('returns viaCount=0 when no waypoints provided', async () => {
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

      expect(body.debug.hereRequest.viaCount).toBe(0);
      expect(body.debug.hereRequest.via).toHaveLength(0);
    });
  });

  describe('country inference', () => {
    it('uses reverseGeocode for coords to get country code', async () => {
      // Mock reverse geocode to return different countries
      mockHereService.reverseGeocode = vi
        .fn()
        .mockResolvedValueOnce({ countryCode: 'POL', label: 'Poznań, Poland' })
        .mockResolvedValueOnce({ countryCode: 'ITA', label: 'Verona, Italy' });

      const app = buildApp({ hereService: mockHereService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {
          origin: { lat: 52.4064, lng: 16.9252 },
          destination: { lat: 45.4384, lng: 10.9916 },
          vehicleProfileId: 'solo_18t_23ep',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      // Verify reverseGeocode was called for both coordinates
      expect(mockHereService.reverseGeocode).toHaveBeenCalledTimes(2);
      expect(mockHereService.reverseGeocode).toHaveBeenCalledWith(52.4064, 16.9252);
      expect(mockHereService.reverseGeocode).toHaveBeenCalledWith(45.4384, 10.9916);

      // Verify country codes are normalized to alpha-2 in routeFacts
      expect(body.routeFacts.geography.originCountry).toBe('PL');
      expect(body.routeFacts.geography.destinationCountry).toBe('IT');
      expect(body.routeFacts.geography.isInternational).toBe(true);
      expect(body.routeFacts.geography.isEU).toBe(true);

      // Verify countries are in countriesCrossed (alpha-2)
      expect(body.routeFacts.geography.countriesCrossed).toContain('PL');
      expect(body.routeFacts.geography.countriesCrossed).toContain('IT');

      // Verify resolved points have raw country code (alpha-3 from HERE)
      expect(body.debug.resolvedPoints.origin.countryCode).toBe('POL');
      expect(body.debug.resolvedPoints.destination.countryCode).toBe('ITA');
    });

    it('uses geocode countryCode for address input (no reverse geocode needed)', async () => {
      // Setup geocode to return with country code
      mockHereService.geocode = vi
        .fn()
        .mockResolvedValueOnce({
          lat: 52.52,
          lng: 13.405,
          label: 'Berlin, Germany',
          countryCode: 'DEU',
          confidence: 0.95,
        })
        .mockResolvedValueOnce({
          lat: 45.46,
          lng: 9.19,
          label: 'Milano, Italy',
          countryCode: 'ITA',
          confidence: 0.92,
        });

      const app = buildApp({ hereService: mockHereService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {
          origin: { address: 'Berlin, Germany' },
          destination: { address: 'Milano, Italy' },
          vehicleProfileId: 'ftl_13_6_33ep',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      // Verify geocode was called (not reverseGeocode)
      expect(mockHereService.geocode).toHaveBeenCalledTimes(2);
      expect(mockHereService.reverseGeocode).not.toHaveBeenCalled();

      // Verify country codes are normalized to alpha-2 in routeFacts
      expect(body.routeFacts.geography.originCountry).toBe('DE');
      expect(body.routeFacts.geography.destinationCountry).toBe('IT');
      expect(body.routeFacts.geography.isInternational).toBe(true);
      expect(body.routeFacts.geography.isEU).toBe(true);

      // Verify resolved points have raw country code (alpha-3 from HERE)
      expect(body.debug.resolvedPoints.origin.countryCode).toBe('DEU');
      expect(body.debug.resolvedPoints.destination.countryCode).toBe('ITA');
    });

    it('sets isEU to false when one country is not in EU', async () => {
      mockHereService.reverseGeocode = vi
        .fn()
        .mockResolvedValueOnce({ countryCode: 'GBR', label: 'London, UK' })
        .mockResolvedValueOnce({ countryCode: 'FRA', label: 'Paris, France' });

      const app = buildApp({ hereService: mockHereService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {
          origin: { lat: 51.5074, lng: -0.1278 },
          destination: { lat: 48.8566, lng: 2.3522 },
          vehicleProfileId: 'van_8ep',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      // UK is not in EU (post-Brexit), France is - codes normalized to alpha-2
      expect(body.routeFacts.geography.originCountry).toBe('GB');
      expect(body.routeFacts.geography.destinationCountry).toBe('FR');
      expect(body.routeFacts.geography.isInternational).toBe(true);
      expect(body.routeFacts.geography.isEU).toBe(false);
    });

    it('sets isInternational to false for domestic routes', async () => {
      mockHereService.reverseGeocode = vi
        .fn()
        .mockResolvedValueOnce({ countryCode: 'DEU', label: 'Berlin, Germany' })
        .mockResolvedValueOnce({ countryCode: 'DEU', label: 'Munich, Germany' });

      const app = buildApp({ hereService: mockHereService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {
          origin: { lat: 52.52, lng: 13.405 },
          destination: { lat: 48.1351, lng: 11.582 },
          vehicleProfileId: 'solo_18t_23ep',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      // Codes normalized to alpha-2
      expect(body.routeFacts.geography.originCountry).toBe('DE');
      expect(body.routeFacts.geography.destinationCountry).toBe('DE');
      expect(body.routeFacts.geography.isInternational).toBe(false);
      expect(body.routeFacts.geography.isEU).toBe(true);
    });
  });

  describe('Alps debug config propagation', () => {
    it('includes alpsConfig.centers in response debug', async () => {
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

      // alpsConfig should be at top level of debug, not inside hereResponse
      expect(body.debug.alpsConfig).toBeDefined();
      expect(body.debug.alpsConfig.centers).toBeDefined();
      expect(body.debug.alpsConfig.centers.frejus).toBeDefined();
      expect(typeof body.debug.alpsConfig.centers.frejus.lat).toBe('number');
      expect(typeof body.debug.alpsConfig.centers.frejus.lng).toBe('number');
      expect(body.debug.alpsConfig.centers.montBlanc).toBeDefined();
      expect(typeof body.debug.alpsConfig.centers.montBlanc.lat).toBe('number');
    });

    it('includes alpsConfig.bboxes in response debug', async () => {
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

      expect(body.debug.alpsConfig.bboxes).toBeDefined();
      expect(body.debug.alpsConfig.bboxes.frejus).toBeDefined();
      expect(typeof body.debug.alpsConfig.bboxes.frejus.minLat).toBe('number');
      expect(typeof body.debug.alpsConfig.bboxes.frejus.maxLat).toBe('number');
    });

    it('includes alpsCenterDistances in response debug', async () => {
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

      // alpsCenterDistances should be at top level of debug
      expect(body.debug.alpsCenterDistances).toBeDefined();
      expect(body.debug.alpsCenterDistances.frejus).toBeDefined();
      expect(typeof body.debug.alpsCenterDistances.frejus.fromOrigin).toBe('number');
      expect(Array.isArray(body.debug.alpsCenterDistances.frejus.fromWaypoints)).toBe(true);
    });

    it('includes waypoint distances when waypoints exist', async () => {
      mockHereService.routeTruck = vi.fn().mockResolvedValue({
        hereResponse: {
          routes: [{
            id: 'mock-route-1',
            sections: [{
              id: 'section-1',
              type: 'vehicle',
              departure: { time: '2024-01-15T08:00:00+01:00', place: { type: 'place', location: { lat: 45.0703, lng: 7.6869 } } },
              arrival: { time: '2024-01-15T14:30:00+01:00', place: { type: 'place', location: { lat: 45.5646, lng: 5.9178 } } },
              summary: { duration: 23400, length: 150000, baseDuration: 21600 },
              transport: { mode: 'truck' },
            }],
          }],
        },
        debug: {
          maskedUrl: 'https://router.hereapi.com/v8/routes?via=45.08%2C6.7!passThrough%3Dtrue',
          via: [{ lat: 45.08, lng: 6.7 }],
          viaCount: 1,
          sectionsCount: 1,
          actionsCountTotal: 0,
          polylinePointsChecked: 0,
          alpsMatch: { frejus: true, montBlanc: false },
          alpsMatchDetails: {
            frejus: { matched: true, pointsInside: 1, matchReason: 'waypointProximity' },
            montBlanc: { matched: false, pointsInside: 0, matchReason: 'none' },
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
            frejus: { fromOrigin: 70, fromWaypoints: [0.88], fromDestination: 82 },
            montBlanc: { fromOrigin: 100, fromWaypoints: [95], fromDestination: 50 },
          },
          polylineSanity: {
            polylineBounds: { minLat: 45.07, maxLat: 45.57, minLng: 5.91, maxLng: 7.69 },
            polylineFirstPoint: { lat: 45.0703, lng: 7.6869 },
            polylineLastPoint: { lat: 45.5646, lng: 5.9178 },
            pointCount: 100,
          },
          waypointProximity: {
            frejus: true,
            montBlanc: false,
            reasons: { frejus: 'waypointProximity', montBlanc: 'none' },
          },
          polylineBoundsPlausible: true,
          alpsMatchReason: { frejus: 'waypointProximity', montBlanc: 'none' },
          samples: [],
        },
      });

      mockHereService.geocode = vi.fn()
        .mockResolvedValueOnce({ lat: 45.0703, lng: 7.6869, label: 'Turin, Italy', countryCode: 'IT' })
        .mockResolvedValueOnce({ lat: 45.08, lng: 6.7, label: 'Bardonecchia, Italy', countryCode: 'IT' })
        .mockResolvedValueOnce({ lat: 45.5646, lng: 5.9178, label: 'Chambéry, France', countryCode: 'FR' });

      const app = buildApp({ hereService: mockHereService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {
          origin: { address: 'Turin, Italy' },
          destination: { address: 'Chambéry, France' },
          waypoints: [{ address: 'Bardonecchia, Italy' }],
          vehicleProfileId: 'solo_18t_23ep',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      // Waypoint distance should be present and be a number
      expect(body.debug.alpsCenterDistances.frejus.fromWaypoints).toHaveLength(1);
      expect(typeof body.debug.alpsCenterDistances.frejus.fromWaypoints[0]).toBe('number');
      expect(body.debug.alpsCenterDistances.frejus.fromWaypoints[0]).toBeLessThan(5); // Bardonecchia is near Frejus
    });

    it('includes polylineBounds in hereResponse when polyline is returned', async () => {
      mockHereService.routeTruck = vi.fn().mockResolvedValue({
        hereResponse: {
          routes: [{
            id: 'mock-route-1',
            sections: [{
              id: 'section-1',
              type: 'vehicle',
              departure: { time: '2024-01-15T08:00:00+01:00', place: { type: 'place', location: { lat: 45.0703, lng: 7.6869 } } },
              arrival: { time: '2024-01-15T14:30:00+01:00', place: { type: 'place', location: { lat: 45.5646, lng: 5.9178 } } },
              summary: { duration: 23400, length: 150000, baseDuration: 21600 },
              transport: { mode: 'truck' },
              polyline: 'BFoz5xJ67i1B1B7PzIhaxL7Y',
            }],
          }],
        },
        debug: {
          maskedUrl: 'https://router.hereapi.com/v8/routes',
          via: [],
          viaCount: 0,
          sectionsCount: 1,
          actionsCountTotal: 0,
          polylinePointsChecked: 100,
          alpsMatch: { frejus: false, montBlanc: false },
          alpsMatchDetails: {
            frejus: { matched: false, pointsInside: 0, matchReason: 'none' },
            montBlanc: { matched: false, pointsInside: 0, matchReason: 'none' },
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
            frejus: { fromOrigin: 70, fromWaypoints: [], fromDestination: 82 },
            montBlanc: { fromOrigin: 100, fromWaypoints: [], fromDestination: 50 },
          },
          polylineSanity: {
            polylineBounds: { minLat: 45.07, maxLat: 45.57, minLng: 5.91, maxLng: 7.69 },
            polylineFirstPoint: { lat: 45.0703, lng: 7.6869 },
            polylineLastPoint: { lat: 45.5646, lng: 5.9178 },
            pointCount: 100,
          },
          waypointProximity: {
            frejus: false,
            montBlanc: false,
            reasons: { frejus: 'none', montBlanc: 'none' },
          },
          polylineBoundsPlausible: true,
          alpsMatchReason: { frejus: 'none', montBlanc: 'none' },
          samples: [],
        },
      });

      const app = buildApp({ hereService: mockHereService });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/api/route-facts',
        payload: {
          origin: { lat: 45.0703, lng: 7.6869 },
          destination: { lat: 45.5646, lng: 5.9178 },
          vehicleProfileId: 'solo_18t_23ep',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      // polylineBounds should be in hereResponse (flattened, not nested)
      expect(body.debug.hereResponse.polylineBounds).toBeDefined();
      expect(typeof body.debug.hereResponse.polylineBounds.minLat).toBe('number');
      expect(typeof body.debug.hereResponse.polylineBounds.maxLat).toBe('number');
      expect(typeof body.debug.hereResponse.polylineBounds.minLng).toBe('number');
      expect(typeof body.debug.hereResponse.polylineBounds.maxLng).toBe('number');

      // polylineFirstPoint and polylineLastPoint should also be present
      expect(body.debug.hereResponse.polylineFirstPoint).toBeDefined();
      expect(body.debug.hereResponse.polylineLastPoint).toBeDefined();
    });
  });
});
