/**
 * Golden end-to-end tests for /api/quote.
 *
 * Unlike quote.test.ts (which stubs HereService.routeTruck entirely), these
 * tests mock ONLY the HTTP layer (global fetch) and run the real pipeline:
 * geocoding -> truck routing -> polyline decoding -> RouteFacts extraction ->
 * geography normalization -> pricing.
 *
 * Golden cases:
 *   A. PL -> IT   (Poznań -> Verona)                    -> solo-pl-eu
 *   B. IT -> DE   (Verona -> Munich)                    -> solo-it-eu + minimum
 *   C. IT -> UK   (Verona -> London)                    -> solo-it-uk + UK surcharge + minimum
 *   D. IT -> FR   (Turin -> via Bardonecchia/Modane -> Chambéry) -> Fréjus detection
 *   E. Robustness (missing optional HERE fields, upstream errors)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../app.js';
import { createHereService } from '../here/index.js';
import { encodeFlexiblePolyline } from '../here/flexible-polyline.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

/** Geocoding fixtures - countryCode is alpha-3 as returned by HERE */
const GEOCODE_FIXTURES: Record<string, { lat: number; lng: number; countryCode: string; label: string }> = {
  'Poznań, Poland': { lat: 52.4064, lng: 16.9252, countryCode: 'POL', label: 'Poznań, Poland' },
  'Verona, Italy': { lat: 45.4384, lng: 10.9916, countryCode: 'ITA', label: 'Verona, Italy' },
  'Munich, Germany': { lat: 48.1374, lng: 11.5755, countryCode: 'DEU', label: 'Munich, Germany' },
  'London, United Kingdom': { lat: 51.5072, lng: -0.1276, countryCode: 'GBR', label: 'London, United Kingdom' },
  'Turin, Italy': { lat: 45.0703, lng: 7.6869, countryCode: 'ITA', label: 'Turin, Italy' },
  'Bardonecchia, Italy': { lat: 45.0787, lng: 6.704, countryCode: 'ITA', label: 'Bardonecchia, Italy' },
  'Modane, France': { lat: 45.199, lng: 6.654, countryCode: 'FRA', label: 'Modane, France' },
  'Chambéry, France': { lat: 45.5646, lng: 5.9178, countryCode: 'FRA', label: 'Chambéry, France' },
};

/** Spec-compliant HERE polyline for Turin -> Bardonecchia -> Fréjus tunnel -> Modane -> Chambéry */
const FREJUS_ROUTE_POLYLINE = encodeFlexiblePolyline([
  { lat: 45.06236, lng: 7.67994 }, // Turin
  { lat: 45.07, lng: 7.2 },
  { lat: 45.07948, lng: 6.69965 }, // Bardonecchia
  { lat: 45.086, lng: 6.706 },     // Fréjus tunnel (inside bbox)
  { lat: 45.1, lng: 6.67 },        // Modane side
  { lat: 45.2, lng: 6.4 },
  { lat: 45.56628, lng: 5.92079 }, // Chambéry
], 5);

interface MockSectionOptions {
  lengthMeters: number;
  durationSeconds: number;
  tollCountries?: string[];
  polyline?: string;
  ferry?: boolean;
  omitTolls?: boolean;
  omitActions?: boolean;
}

function buildSection(opts: MockSectionOptions) {
  const section: Record<string, unknown> = {
    id: `section-${Math.abs(opts.lengthMeters)}`,
    type: opts.ferry ? 'ferry' : 'vehicle',
    departure: { time: '2024-01-15T08:00:00+01:00', place: { type: 'place', location: { lat: 0, lng: 0 } } },
    arrival: { time: '2024-01-15T18:00:00+01:00', place: { type: 'place', location: { lat: 0, lng: 0 } } },
    summary: {
      duration: opts.durationSeconds,
      length: opts.lengthMeters,
      baseDuration: opts.durationSeconds,
    },
    transport: { mode: opts.ferry ? 'ferry' : 'truck' },
  };

  if (!opts.omitActions) {
    section.actions = [
      { action: 'depart', duration: 0, length: 0, instruction: 'Start', offset: 0 },
    ];
  }

  if (!opts.omitTolls && opts.tollCountries && opts.tollCountries.length > 0) {
    section.tolls = [
      {
        tolls: opts.tollCountries.map((countryCode) => ({
          countryCode,
          tollSystem: 'Test',
          fares: [{ id: 'fare-1', price: { type: 'total', value: '10.00', currency: 'EUR' } }],
        })),
      },
    ];
  }

  if (opts.polyline) {
    section.polyline = opts.polyline;
  }

  return section;
}

function buildRoutingResponse(sections: Array<Record<string, unknown>>) {
  return { routes: [{ id: 'golden-route-1', sections }] };
}

/**
 * Install a fetch mock that serves geocoding fixtures and the given routing
 * response. Records routing request URLs into the returned array.
 */
function installFetchMock(routingResponse: unknown): string[] {
  const routingUrls: string[] = [];

  mockFetch.mockImplementation(async (url: string) => {
    const parsed = new URL(url);

    if (parsed.hostname.includes('geocode.search')) {
      const q = parsed.searchParams.get('q') ?? '';
      const fixture = GEOCODE_FIXTURES[q];
      if (!fixture) {
        return { ok: true, json: async () => ({ items: [] }) };
      }
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              title: fixture.label,
              id: `geo-${q}`,
              resultType: 'locality',
              address: { label: fixture.label, countryCode: fixture.countryCode },
              position: { lat: fixture.lat, lng: fixture.lng },
              scoring: { queryScore: 0.99 },
            },
          ],
        }),
      };
    }

    if (parsed.hostname.includes('router.hereapi.com')) {
      routingUrls.push(url);
      return { ok: true, json: async () => routingResponse };
    }

    throw new Error(`Unexpected URL in test: ${parsed.hostname}`);
  });

  return routingUrls;
}

function buildTestApp() {
  const hereService = createHereService({ apiKey: 'test-api-key', maxRetries: 0 });
  return buildApp({ hereService });
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('Golden case A: PL -> IT (Poznań -> Verona, solo_18t_23ep)', () => {
  it('prices with solo-pl-eu: finalPrice = distanceKm + 200', async () => {
    installFetchMock(buildRoutingResponse([
      buildSection({ lengthMeters: 1100000, durationSeconds: 14 * 3600, tollCountries: ['POL', 'CZE', 'AUT', 'ITA'] }),
    ]));

    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/quote',
      payload: {
        origin: { address: 'Poznań, Poland' },
        destination: { address: 'Verona, Italy' },
        vehicleProfileId: 'solo_18t_23ep',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    // No NO_MODEL_AVAILABLE
    expect(body.error).toBeUndefined();

    // Model and geography
    expect(body.quote.modelId).toBe('solo-pl-eu');
    expect(body.routeFacts.geography.originCountry).toBe('PL');
    expect(body.routeFacts.geography.destinationCountry).toBe('IT');
    expect(body.routeFacts.geography.isInternational).toBe(true);
    expect(body.routeFacts.geography.isEU).toBe(true);

    // Route facts
    expect(body.routeFacts.route.distanceKm).toBe(1100);
    expect(body.routeFacts.route.durationHours).toBeGreaterThan(0);

    // Pricing: (1100 + 200) * 1.0 = 1300
    expect(body.quote.lineItems.kmCharge).toBe(1100);
    expect(body.quote.lineItems.emptiesCharge).toBe(200);
    expect(body.quote.finalPrice).toBe(1300);
    expect(body.quote.currency).toBe('EUR');
  });
});

describe('Golden case B: IT -> DE (Verona -> Munich, solo_18t_23ep)', () => {
  it('prices with solo-it-eu: kmCharge = km * 1.2, empties 200, min 1200', async () => {
    installFetchMock(buildRoutingResponse([
      buildSection({ lengthMeters: 430000, durationSeconds: 6 * 3600, tollCountries: ['ITA', 'AUT', 'DEU'] }),
    ]));

    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/quote',
      payload: {
        origin: { address: 'Verona, Italy' },
        destination: { address: 'Munich, Germany' },
        vehicleProfileId: 'solo_18t_23ep',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.quote.modelId).toBe('solo-it-eu');
    expect(body.routeFacts.geography.originCountry).toBe('IT');
    expect(body.routeFacts.geography.destinationCountry).toBe('DE');

    // kmCharge = 430 * 1.2 = 516, empties = 200 flat
    expect(body.quote.lineItems.kmCharge).toBeCloseTo(516, 2);
    expect(body.quote.lineItems.emptiesCharge).toBe(200);

    // Subtotal 716 < defaultMin 1200 -> minimum applied
    expect(body.quote.lineItems.minimumAdjustment).toBeCloseTo(484, 2);
    expect(body.quote.finalPrice).toBe(1200);
  });
});

describe('Golden case C: IT -> UK (Verona -> London, solo_18t_23ep)', () => {
  it('prices with solo-it-uk: UK detection, +400 surcharge, min 2700', async () => {
    installFetchMock(buildRoutingResponse([
      buildSection({ lengthMeters: 1550000, durationSeconds: 18 * 3600, tollCountries: ['ITA', 'FRA'] }),
      // Channel crossing
      buildSection({ lengthMeters: 50000, durationSeconds: 2 * 3600, ferry: true, omitActions: true }),
    ]));

    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/quote',
      payload: {
        origin: { address: 'Verona, Italy' },
        destination: { address: 'London, United Kingdom' },
        vehicleProfileId: 'solo_18t_23ep',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    // UK/GB detection (GBR from geocoder normalized to GB)
    expect(body.routeFacts.geography.destinationCountry).toBe('GB');
    expect(body.routeFacts.riskFlags.isUK).toBe(true);
    expect(body.routeFacts.geography.isEU).toBe(false);
    expect(body.routeFacts.infrastructure.hasFerry).toBe(true);

    // Model and surcharge
    expect(body.quote.modelId).toBe('solo-it-uk');
    const ukSurcharge = body.quote.lineItems.surcharges.find(
      (s: { type: string }) => s.type === 'ukFerry'
    );
    expect(ukSurcharge).toBeDefined();
    expect(ukSurcharge.amount).toBe(400);

    // 1600 * 1.2 + 200 + 400 = 2520 < 2700 -> minimum applied
    expect(body.quote.lineItems.kmCharge).toBeCloseTo(1920, 2);
    expect(body.quote.lineItems.emptiesCharge).toBe(200);
    expect(body.quote.lineItems.minimumAdjustment).toBeCloseTo(180, 2);
    expect(body.quote.finalPrice).toBe(2700);
  });
});

describe('Golden case D: IT -> FR via Fréjus (Turin -> Bardonecchia -> Modane -> Chambéry)', () => {
  function installFrejusMock() {
    return installFetchMock(buildRoutingResponse([
      buildSection({
        lengthMeters: 180000,
        durationSeconds: 3 * 3600,
        tollCountries: ['ITA', 'FRA'],
        polyline: FREJUS_ROUTE_POLYLINE,
      }),
    ]));
  }

  const payload = {
    origin: { address: 'Turin, Italy' },
    via: [
      { address: 'Bardonecchia, Italy' },
      { address: 'Modane, France' },
    ],
    destination: { address: 'Chambéry, France' },
    vehicleProfileId: 'solo_18t_23ep',
  };

  it('detects Fréjus via polyline bbox, applies +200 Alps surcharge', async () => {
    installFrejusMock();
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({ method: 'POST', url: '/api/quote', payload });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    // Alps detection in RouteFacts
    expect(body.routeFacts.riskFlags.crossesAlps).toBe(true);
    expect(body.routeFacts.infrastructure.hasTunnel).toBe(true);
    const tunnelNames = body.routeFacts.infrastructure.tunnels.map(
      (t: { name: string | null }) => t.name
    );
    expect(tunnelNames).toContain('Fréjus Tunnel');

    // +200 Alps surcharge
    const alpsSurcharge = body.quote.lineItems.surcharges.find(
      (s: { type: string }) => s.type === 'alpsTunnel'
    );
    expect(alpsSurcharge).toBeDefined();
    expect(alpsSurcharge.amount).toBe(200);

    // Debug clearly shows the match reason (polyline bbox is primary here)
    expect(['polylineBbox', 'waypointProximity']).toContain(
      body.debug.hereResponse.alpsMatchReason.frejus
    );
    expect(body.debug.hereResponse.alpsMatchReason.frejus).toBe('polylineBbox');
  });

  it('decodes polyline with plausible European bounds (no lng=0 corruption)', async () => {
    installFrejusMock();
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({ method: 'POST', url: '/api/quote', payload });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    const hereDebug = body.debug.hereResponse;

    // First point is Turin - lng must NOT be 0
    expect(hereDebug.polylineFirstPoint).not.toBeNull();
    expect(hereDebug.polylineFirstPoint.lat).toBeCloseTo(45.06236, 3);
    expect(hereDebug.polylineFirstPoint.lng).toBeCloseTo(7.67994, 3);
    expect(Math.abs(hereDebug.polylineFirstPoint.lng)).toBeGreaterThan(1);

    // Bounds plausible; minLng > 5 for this route (westernmost point is Chambéry ~5.92)
    expect(hereDebug.polylineBoundsPlausible).toBe(true);
    expect(hereDebug.polylineBounds.minLng).toBeGreaterThan(5);
    expect(hereDebug.polylineBounds.maxLng).toBeLessThan(9);
    expect(hereDebug.polylineBounds.minLat).toBeGreaterThan(44);
    expect(hereDebug.polylineBounds.maxLat).toBeLessThan(47);

    // No corruption fixes should be needed with the spec-compliant decoder
    expect(hereDebug.polylineSwapApplied).toBe(false);
    expect(hereDebug.firstPointLngPatched).toBe(false);
    expect(hereDebug.firstPointLngPatchReason).toBe('none');

    // Before/after debug points are present and identical (no fix applied)
    expect(hereDebug.decodedFirstTwoPointsBeforeFix).not.toBeNull();
    expect(hereDebug.decodedFirstTwoPointsAfterFix).not.toBeNull();
    expect(hereDebug.decodedFirstTwoPointsBeforeFix[0].lng).toBeGreaterThan(5);
    expect(hereDebug.polylineInputDiagnostics.validPolylineCount).toBe(1);
  });

  it('propagates via waypoints to HERE with passThrough and exposes viaCount', async () => {
    const routingUrls = installFrejusMock();
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({ method: 'POST', url: '/api/quote', payload });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    // viaCount in debug
    expect(body.debug.hereRequest.viaCount).toBe(2);
    expect(body.debug.hereRequest.via).toHaveLength(2);

    // Actual HERE request has via=<lat>,<lng>!passThrough=true and correct return params
    expect(routingUrls).toHaveLength(1);
    const url = new URL(routingUrls[0]);
    const viaParams = url.searchParams.getAll('via');
    expect(viaParams).toHaveLength(2);
    expect(viaParams[0]).toBe('45.0787,6.704!passThrough=true');
    expect(viaParams[1]).toBe('45.199,6.654!passThrough=true');
    expect(url.searchParams.get('return')).toBe('summary,tolls,polyline,actions');
    expect(url.searchParams.get('transportMode')).toBe('truck');

    // Masked URL in debug must not contain the API key
    expect(body.debug.hereRequest.maskedUrl).not.toContain('test-api-key');
    expect(body.debug.hereRequest.maskedUrl).not.toContain('apiKey');
  });
});

describe('Golden case E: robustness', () => {
  it('does not crash when tolls, actions, and polyline are all missing', async () => {
    installFetchMock(buildRoutingResponse([
      buildSection({ lengthMeters: 500000, durationSeconds: 7 * 3600, omitTolls: true, omitActions: true }),
    ]));

    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/quote',
      payload: {
        origin: { address: 'Poznań, Poland' },
        destination: { address: 'Munich, Germany' },
        vehicleProfileId: 'solo_18t_23ep',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.quote.modelId).toBe('solo-pl-eu');
    // (500 + 200) * 1.0 = 700
    expect(body.quote.finalPrice).toBe(700);
    // Geography still comes from geocoding, not tolls
    expect(body.routeFacts.geography.originCountry).toBe('PL');
    expect(body.routeFacts.geography.destinationCountry).toBe('DE');
    expect(body.routeFacts.infrastructure.hasTollRoads).toBe(false);
  });

  it('handles malformed toll entries without crashing', async () => {
    const section = buildSection({ lengthMeters: 500000, durationSeconds: 7 * 3600 });
    // Malformed shapes seen in the wild: null entries, missing nested arrays
    section.tolls = [null, { tolls: null }, { tolls: [{ countryCode: null }, null, { countryCode: 'DEU', tollSystem: 'x' }] }];
    installFetchMock(buildRoutingResponse([section]));

    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/quote',
      payload: {
        origin: { address: 'Poznań, Poland' },
        destination: { address: 'Munich, Germany' },
        vehicleProfileId: 'solo_18t_23ep',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.quote.finalPrice).toBe(700);
    expect(body.routeFacts.infrastructure.tollCountries).toEqual(['DEU']);
  });

  it('returns structured JSON (502 UPSTREAM_ERROR) when HERE routing fails, without leaking the key', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.hostname.includes('geocode.search')) {
        const q = parsed.searchParams.get('q') ?? '';
        const fixture = GEOCODE_FIXTURES[q]!;
        return {
          ok: true,
          json: async () => ({
            items: [{
              title: fixture.label,
              id: 'geo-1',
              resultType: 'locality',
              address: { label: fixture.label, countryCode: fixture.countryCode },
              position: { lat: fixture.lat, lng: fixture.lng },
            }],
          }),
        };
      }
      // Routing upstream failure
      return {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: { get: () => null },
        text: async () => '{"title":"Internal error"}',
      };
    });

    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/quote',
      payload: {
        origin: { address: 'Poznań, Poland' },
        destination: { address: 'Verona, Italy' },
        vehicleProfileId: 'solo_18t_23ep',
      },
    });

    expect(response.statusCode).toBe(502);
    const body = response.json();
    expect(body.error.code).toBe('UPSTREAM_ERROR');
    expect(typeof body.error.message).toBe('string');
    expect(JSON.stringify(body)).not.toContain('test-api-key');
  });

  it('returns structured JSON when geocoding finds no results', async () => {
    installFetchMock(buildRoutingResponse([]));

    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/quote',
      payload: {
        origin: { address: 'Nowhere That Exists XYZ' },
        destination: { address: 'Verona, Italy' },
        vehicleProfileId: 'solo_18t_23ep',
      },
    });

    // Geocoding failure surfaces as a structured error, not a crash
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    const body = response.json();
    expect(body.error).toBeDefined();
    expect(typeof body.error.code).toBe('string');
    expect(typeof body.error.message).toBe('string');
  });
});
