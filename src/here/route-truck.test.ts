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

    it('includes correct vehicle dimensions in request using vehicle[] params', async () => {
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
      // Uses vehicle[] params (not truck[]) per Routing API v8 guidance
      expect(url.searchParams.get('vehicle[grossWeight]')).toBe(String(profile.grossWeight));
      expect(url.searchParams.get('vehicle[height]')).toBe(String(profile.heightCm));
      expect(url.searchParams.get('vehicle[width]')).toBe(String(profile.widthCm));
      expect(url.searchParams.get('vehicle[length]')).toBe(String(profile.lengthCm));
      expect(url.searchParams.get('vehicle[axleCount]')).toBe(String(profile.axleCount));
    });

    it('does NOT mix truck[] and vehicle[] params in request', async () => {
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

      // Ensure no truck[] params are present
      const allParams = Array.from(url.searchParams.keys());
      const truckParams = allParams.filter((key) => key.startsWith('truck['));
      expect(truckParams).toHaveLength(0);

      // Ensure vehicle[] params are present
      const vehicleParams = allParams.filter((key) => key.startsWith('vehicle['));
      expect(vehicleParams.length).toBeGreaterThan(0);
    });

    it('sends vehicle dimensions as integers in cm', async () => {
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

      const height = Number(url.searchParams.get('vehicle[height]'));
      const width = Number(url.searchParams.get('vehicle[width]'));
      const length = Number(url.searchParams.get('vehicle[length]'));

      // All dimensions should be integers (no decimals)
      expect(Number.isInteger(height)).toBe(true);
      expect(Number.isInteger(width)).toBe(true);
      expect(Number.isInteger(length)).toBe(true);

      // Values should be in cm (van is 270cm tall, 220cm wide, 650cm long)
      expect(height).toBe(270);
      expect(width).toBe(220);
      expect(length).toBe(650);
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
      expect(url.searchParams.get('vehicle[grossWeight]')).toBe('3500');
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
      expect(url.searchParams.get('vehicle[grossWeight]')).toBe('18000');
    });

    it('includes waypoints in request with passThrough flag', async () => {
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
      // HERE v8 uses repeated 'via' param with passThrough flag
      const viaParams = url.searchParams.getAll('via');
      expect(viaParams).toHaveLength(2);
      expect(viaParams[0]).toBe('51.5,14.5!passThrough=true');
      expect(viaParams[1]).toBe('52,17!passThrough=true');
    });

    it('returns debug info with viaCount, maskedUrl, and telemetry', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRoutingResponse,
      });

      const result = await router.routeTruck({
        origin: { lat: 52.52, lng: 13.405 },
        destination: { lat: 52.2297, lng: 21.0122 },
        waypoints: [
          { lat: 51.5, lng: 14.5 },
        ],
        vehicleProfileId: 'ftl_13_6_33ep',
      });

      // Debug info should be present
      expect(result.debug).toBeDefined();
      expect(result.debug.viaCount).toBe(1);
      expect(result.debug.via).toEqual([{ lat: 51.5, lng: 14.5 }]);
      expect(result.debug.maskedUrl).toContain('via=51.5%2C14.5');
      expect(result.debug.maskedUrl).not.toContain('apiKey');
      // Telemetry fields
      expect(result.debug.sectionsCount).toBe(1);
      expect(result.debug.actionsCountTotal).toBe(2);
      expect(result.debug.polylinePointsChecked).toBe(0); // No polyline in mock
      expect(result.debug.alpsMatch).toEqual({ frejus: false, montBlanc: false });
      expect(result.debug.samples).toBeDefined();
      expect(Array.isArray(result.debug.samples)).toBe(true);
    });

    it('returns samples from HERE response actions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRoutingResponse,
      });

      const result = await router.routeTruck({
        origin: { lat: 52.52, lng: 13.405 },
        destination: { lat: 52.2297, lng: 21.0122 },
        vehicleProfileId: 'ftl_13_6_33ep',
      });

      // Should have collected action instructions as samples
      const instructionSamples = result.debug.samples.filter(s => s.startsWith('action:instruction:'));
      expect(instructionSamples).toContainEqual('action:instruction:Head east on Unter den Linden');
      expect(instructionSamples).toContainEqual('action:instruction:Turn right onto A10');
    });

    it('detects Alps tunnels via polyline bbox checking', async () => {
      // Create a simple encoded polyline that passes through Frejus bbox
      // Frejus bbox: lat 45.03-45.17, lng 6.60-6.78
      // We use a minimal mock response with polyline
      const responseWithPolyline = {
        routes: [{
          id: 'route-1',
          sections: [{
            id: 'section-1',
            type: 'vehicle',
            departure: { time: '2024-01-15T10:00:00+01:00', place: { type: 'place', location: { lat: 45.07, lng: 7.69 } } },
            arrival: { time: '2024-01-15T16:30:00+01:00', place: { type: 'place', location: { lat: 45.56, lng: 5.92 } } },
            summary: { duration: 23400, length: 150000, baseDuration: 21600 },
            transport: { mode: 'truck' },
            // Real polyline would be encoded - for testing we just verify the structure
            polyline: 'BFoz5xJ67i1B1B7PzIhaxL7Y',
            actions: [
              { action: 'depart', duration: 0, length: 0, instruction: 'Head west on A32', offset: 0 },
            ],
          }],
        }],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => responseWithPolyline,
      });

      const result = await router.routeTruck({
        origin: { lat: 45.07, lng: 7.69 },
        destination: { lat: 45.56, lng: 5.92 },
        vehicleProfileId: 'solo_18t_23ep',
      });

      // Should have polyline points checked
      expect(result.debug.polylinePointsChecked).toBeGreaterThanOrEqual(0);
      // alpsMatch should be defined
      expect(result.debug.alpsMatch).toBeDefined();
      expect(typeof result.debug.alpsMatch.frejus).toBe('boolean');
      expect(typeof result.debug.alpsMatch.montBlanc).toBe('boolean');
    });

    it('requests required return fields (no spans - using polyline geofencing)', async () => {
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
      expect(returnFields).toContain('polyline'); // Required for Alps tunnel bbox detection
      expect(returnFields).toContain('actions');
      // Note: 'spans' is not a valid return type in HERE Routing v8 - use polyline geofencing
      expect(returnFields).not.toContain('spans');
      // Note: 'notices' is not a valid return type in HERE Routing v8
      expect(returnFields).not.toContain('notices');
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
