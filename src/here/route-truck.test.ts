import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTruckRouter } from './route-truck.js';
import { createHereClient, HereApiError } from './http-client.js';
import { VEHICLE_PROFILES } from './vehicle-profiles.js';

// Mock the global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('TruckRouter', () => {
  const apiKey = 'test-api-key';
  let router: ReturnType<typeof createTruckRouter>;

  beforeEach(() => {
    mockFetch.mockReset();
    const client = createHereClient({ apiKey, maxRetries: 0 });
    router = createTruckRouter(client);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockRoutingResponse = {
    routes: [
      {
        id: 'route-1',
        sections: [
          {
            id: 'section-1',
            type: 'vehicle',
            departure: {
              time: '2024-01-15T10:00:00+01:00',
              place: {
                type: 'place',
                location: { lat: 52.52, lng: 13.405 },
              },
            },
            arrival: {
              time: '2024-01-15T16:30:00+01:00',
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
            transport: {
              mode: 'truck',
            },
            actions: [
              {
                action: 'depart',
                duration: 0,
                length: 0,
                instruction: 'Head east on Unter den Linden',
                offset: 0,
              },
              {
                action: 'turn',
                duration: 120,
                length: 1500,
                instruction: 'Turn right onto A10',
                offset: 1,
                direction: 'right',
              },
            ],
            tolls: [
              {
                tolls: [
                  {
                    countryCode: 'DEU',
                    tollSystem: 'Toll Collect',
                    fares: [
                      {
                        id: 'fare-1',
                        price: {
                          type: 'total',
                          value: '45.50',
                          currency: 'EUR',
                        },
                      },
                    ],
                  },
                ],
              },
            ],
            notices: [
              {
                title: 'Road works ahead',
                code: 'roadworks',
                severity: 'low',
              },
            ],
          },
        ],
      },
    ],
  };

  describe('routeTruck', () => {
    it('returns route for valid origin and destination', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRoutingResponse,
      });

      const result = await router.routeTruck({
        origin: { lat: 52.52, lng: 13.405 },
        destination: { lat: 52.2297, lng: 21.0122 },
        vehicleProfileId: 'ftl_13_6_33ep',
      });

      expect(result.hereResponse).toBeDefined();
      expect(result.hereResponse.routes).toHaveLength(1);
      expect(result.hereResponse.routes[0].sections[0].summary.length).toBe(574000);
    });

    it('includes correct vehicle dimensions in request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRoutingResponse,
      });

      await router.routeTruck({
        origin: { lat: 52.52, lng: 13.405 },
        destination: { lat: 52.2297, lng: 21.0122 },
        vehicleProfileId: 'ftl_13_6_33ep',
      });

      const url = new URL(mockFetch.mock.calls[0][0]);
      const profile = VEHICLE_PROFILES['ftl_13_6_33ep'];

      expect(url.searchParams.get('transportMode')).toBe('truck');
      expect(url.searchParams.get('truck[grossWeight]')).toBe(String(profile.grossWeight));
      expect(url.searchParams.get('truck[height]')).toBe(String(Math.round(profile.height * 100)));
      expect(url.searchParams.get('truck[width]')).toBe(String(Math.round(profile.width * 100)));
      expect(url.searchParams.get('truck[length]')).toBe(String(Math.round(profile.length * 100)));
      expect(url.searchParams.get('truck[axleCount]')).toBe(String(profile.axleCount));
    });

    it('uses correct profile for van', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRoutingResponse,
      });

      await router.routeTruck({
        origin: { lat: 52.52, lng: 13.405 },
        destination: { lat: 52.2297, lng: 21.0122 },
        vehicleProfileId: 'van_8ep',
      });

      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.searchParams.get('truck[grossWeight]')).toBe('3500');
    });

    it('uses correct profile for solo truck', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRoutingResponse,
      });

      await router.routeTruck({
        origin: { lat: 52.52, lng: 13.405 },
        destination: { lat: 52.2297, lng: 21.0122 },
        vehicleProfileId: 'solo_18t_23ep',
      });

      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.searchParams.get('truck[grossWeight]')).toBe('18000');
    });

    it('includes waypoints in request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRoutingResponse,
      });

      await router.routeTruck({
        origin: { lat: 52.52, lng: 13.405 },
        destination: { lat: 52.2297, lng: 21.0122 },
        waypoints: [
          { lat: 51.5, lng: 14.5 },
          { lat: 52.0, lng: 17.0 },
        ],
        vehicleProfileId: 'ftl_13_6_33ep',
      });

      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.searchParams.get('via0')).toBe('51.5,14.5');
      expect(url.searchParams.get('via1')).toBe('52,17');
    });

    it('requests required return fields', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRoutingResponse,
      });

      await router.routeTruck({
        origin: { lat: 52.52, lng: 13.405 },
        destination: { lat: 52.2297, lng: 21.0122 },
        vehicleProfileId: 'ftl_13_6_33ep',
      });

      const url = new URL(mockFetch.mock.calls[0][0]);
      const returnFields = url.searchParams.get('return');
      expect(returnFields).toContain('summary');
      expect(returnFields).toContain('tolls');
      expect(returnFields).toContain('actions');
      expect(returnFields).toContain('notices');
    });

    it('includes toll information in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRoutingResponse,
      });

      const result = await router.routeTruck({
        origin: { lat: 52.52, lng: 13.405 },
        destination: { lat: 52.2297, lng: 21.0122 },
        vehicleProfileId: 'ftl_13_6_33ep',
      });

      const section = result.hereResponse.routes[0].sections[0];
      expect(section.tolls).toBeDefined();
      expect(section.tolls![0].tolls[0].countryCode).toBe('DEU');
    });

    it('includes actions in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRoutingResponse,
      });

      const result = await router.routeTruck({
        origin: { lat: 52.52, lng: 13.405 },
        destination: { lat: 52.2297, lng: 21.0122 },
        vehicleProfileId: 'ftl_13_6_33ep',
      });

      const section = result.hereResponse.routes[0].sections[0];
      expect(section.actions).toBeDefined();
      expect(section.actions!.length).toBe(2);
      expect(section.actions![0].action).toBe('depart');
    });

    it('includes notices/warnings in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRoutingResponse,
      });

      const result = await router.routeTruck({
        origin: { lat: 52.52, lng: 13.405 },
        destination: { lat: 52.2297, lng: 21.0122 },
        vehicleProfileId: 'ftl_13_6_33ep',
      });

      const section = result.hereResponse.routes[0].sections[0];
      expect(section.notices).toBeDefined();
      expect(section.notices![0].code).toBe('roadworks');
    });

    it('propagates API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: 'Invalid coordinates' }),
      });

      await expect(
        router.routeTruck({
          origin: { lat: 999, lng: 999 },
          destination: { lat: 52.2297, lng: 21.0122 },
          vehicleProfileId: 'ftl_13_6_33ep',
        })
      ).rejects.toThrow(HereApiError);
    });
  });
});
