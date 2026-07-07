/**
 * Golden end-to-end tests for /api/quote.
 *
 * Unlike quote.test.ts (which stubs HereService.routeTruck entirely), these
 * tests mock ONLY the HTTP layer (global fetch) and run the real pipeline:
 * geocoding -> truck routing -> polyline decoding -> RouteFacts extraction ->
 * geography normalization -> pricing.
 *
 * Golden cases:
 *   A. PL -> IT   (Poznań -> Verona)                    -> solo-pl-europe
 *   B. IT -> DE   (Verona -> Munich)                    -> solo-europe + minimum
 *   C. IT -> UK   (Verona -> London)                    -> solo-europe + UK surcharge + ukMin
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

/** Reverse geocode fixture served for restriction segment midpoints */
const REVGEO_FIXTURE = {
  label: 'Brennero, Trentino-South Tyrol, Italy',
  countryCode: 'ITA',
  city: 'Brennero',
  county: 'Bolzano',
  state: 'Trentino-South Tyrol',
  street: 'A22',
};

/** URLs of reverse geocode calls made since the last installFetchMock() */
let revgeocodeUrls: string[] = [];
/** When true, the mocked reverse geocode endpoint returns HTTP 500 */
let revgeocodeFails = false;

/**
 * Install a fetch mock that serves geocoding fixtures and the given routing
 * response. Records routing request URLs into the returned array.
 */
function installFetchMock(routingResponse: unknown): string[] {
  const routingUrls: string[] = [];
  revgeocodeUrls = [];
  revgeocodeFails = false;

  mockFetch.mockImplementation(async (url: string) => {
    const parsed = new URL(url);

    if (parsed.hostname.includes('revgeocode.search')) {
      revgeocodeUrls.push(url);
      if (revgeocodeFails) {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: { get: () => null },
          text: async () => '{"title":"revgeo down"}',
        };
      }
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              title: REVGEO_FIXTURE.label,
              id: 'revgeo-1',
              resultType: 'street',
              address: { ...REVGEO_FIXTURE },
              position: { lat: 46.885, lng: 11.375 },
            },
          ],
        }),
      };
    }

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
  it('prices with solo-pl-europe: finalPrice = distanceKm + 200', async () => {
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
    expect(body.quote.modelId).toBe('solo-pl-europe');
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

    // Clean route + pricing model -> valid, operational quote
    expect(body.admissibility.status).toBe('valid');
    expect(body.admissibility.quoteValid).toBe(true);
    expect(body.admissibility.routeUsable).toBe(true);
    expect(body.admissibility.hardConstraintViolation).toBe(false);
    expect(body.quote.validForOperations).toBe(true);
  });
});

describe('Golden case B: IT -> DE (Verona -> Munich, solo_18t_23ep)', () => {
  it('prices with solo-europe: kmCharge = km * 1.2, rated empties 240, min 1200', async () => {
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

    expect(body.quote.modelId).toBe('solo-europe');
    expect(body.routeFacts.geography.originCountry).toBe('IT');
    expect(body.routeFacts.geography.destinationCountry).toBe('DE');

    // kmCharge = 430 * 1.2 = 516, empties rated: 200 km * 1.2 = 240
    expect(body.quote.lineItems.kmCharge).toBeCloseTo(516, 2);
    expect(body.quote.lineItems.emptiesCharge).toBe(240);

    // Subtotal 756 < defaultMin 1200 -> minimum applied
    expect(body.quote.lineItems.minimumAdjustment).toBeCloseTo(444, 2);
    expect(body.quote.finalPrice).toBe(1200);
  });
});

describe('Golden case C: IT -> UK (Verona -> London, solo_18t_23ep)', () => {
  it('prices with solo-europe ukMin: UK detection, +400 surcharge, min 2700', async () => {
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
    expect(body.quote.modelId).toBe('solo-europe');
    const ukSurcharge = body.quote.lineItems.surcharges.find(
      (s: { type: string }) => s.type === 'ukFerry'
    );
    expect(ukSurcharge).toBeDefined();
    expect(ukSurcharge.amount).toBe(400);

    // 1600 * 1.2 + 240 rated empties + 400 = 2560 < ukMin 2700 -> minimum applied
    expect(body.quote.lineItems.kmCharge).toBeCloseTo(1920, 2);
    expect(body.quote.lineItems.emptiesCharge).toBe(240);
    expect(body.quote.lineItems.minimumAdjustment).toBeCloseTo(140, 2);
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

describe('Route geometry (includeGeometry flag)', () => {
  const frejusPayload = {
    origin: { address: 'Turin, Italy' },
    via: [{ address: 'Bardonecchia, Italy' }, { address: 'Modane, France' }],
    destination: { address: 'Chambéry, France' },
    vehicleProfileId: 'solo_18t_23ep',
  };

  function frejusRoutingResponse() {
    return buildRoutingResponse([
      buildSection({
        lengthMeters: 180000,
        durationSeconds: 3 * 3600,
        tollCountries: ['ITA', 'FRA'],
        polyline: FREJUS_ROUTE_POLYLINE,
      }),
    ]);
  }

  it('returns corrected routeGeometry for the Fréjus case when includeGeometry is true', async () => {
    installFetchMock(frejusRoutingResponse());
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/quote',
      payload: { ...frejusPayload, includeGeometry: true },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.routeGeometry).toBeDefined();
    const geo = body.routeGeometry;

    // Points exist and match the decoded route (7 fixture points, no cap needed)
    expect(geo.points.length).toBeGreaterThanOrEqual(2);
    expect(geo.pointCount).toBe(geo.points.length);
    expect(geo.simplified).toBe(false);

    // First point is Turin - NO lng~0 corruption after the spec-compliant decoder
    expect(geo.points[0].lat).toBeCloseTo(45.06236, 4);
    expect(geo.points[0].lng).toBeCloseTo(7.67994, 4);
    expect(Math.abs(geo.points[0].lng)).toBeGreaterThan(1);

    // Last point is Chambéry
    const last = geo.points[geo.points.length - 1];
    expect(last.lat).toBeCloseTo(45.56628, 4);
    expect(last.lng).toBeCloseTo(5.92079, 4);

    // Bounds are plausible for the Turin->Chambéry corridor
    expect(geo.bounds.minLng).toBeGreaterThan(5);
    expect(geo.bounds.maxLng).toBeLessThan(9);
    expect(geo.bounds.minLat).toBeGreaterThan(44);
    expect(geo.bounds.maxLat).toBeLessThan(47);
  });

  it('does not return routeGeometry when includeGeometry is omitted or false', async () => {
    installFetchMock(frejusRoutingResponse());
    const app = buildTestApp();
    await app.ready();

    const omitted = await app.inject({ method: 'POST', url: '/api/quote', payload: frejusPayload });
    expect(omitted.statusCode).toBe(200);
    expect(omitted.json().routeGeometry).toBeUndefined();

    const explicitFalse = await app.inject({
      method: 'POST',
      url: '/api/quote',
      payload: { ...frejusPayload, includeGeometry: false },
    });
    expect(explicitFalse.statusCode).toBe(200);
    expect(explicitFalse.json().routeGeometry).toBeUndefined();
  });

  it('downsamples long routes to the point cap, preserving first and last points', async () => {
    // Synthetic 2500-point route along the Turin->Chambéry corridor
    const manyPoints = Array.from({ length: 2500 }, (_, i) => {
      const t = i / 2499;
      return { lat: 45.06236 + t * 0.5, lng: 7.67994 - t * 1.75 };
    });
    installFetchMock(buildRoutingResponse([
      buildSection({
        lengthMeters: 180000,
        durationSeconds: 3 * 3600,
        tollCountries: ['ITA', 'FRA'],
        polyline: encodeFlexiblePolyline(manyPoints, 5),
      }),
    ]));
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/quote',
      payload: { ...frejusPayload, includeGeometry: true },
    });

    expect(response.statusCode).toBe(200);
    const geo = response.json().routeGeometry;
    expect(geo).toBeDefined();
    expect(geo.simplified).toBe(true);
    expect(geo.points.length).toBeLessThanOrEqual(1000);
    expect(geo.points.length).toBeGreaterThan(100);
    // First and last points preserved exactly
    expect(geo.points[0].lat).toBeCloseTo(manyPoints[0].lat, 4);
    expect(geo.points[0].lng).toBeCloseTo(manyPoints[0].lng, 4);
    const last = geo.points[geo.points.length - 1];
    expect(last.lat).toBeCloseTo(manyPoints[2499].lat, 4);
    expect(last.lng).toBeCloseTo(manyPoints[2499].lng, 4);
    // Bounds still cover the full (pre-simplification) route
    expect(geo.bounds.minLng).toBeCloseTo(7.67994 - 1.75, 3);
    expect(geo.bounds.maxLng).toBeCloseTo(7.67994, 3);
  });
});

describe('Country exclusion (excludeCountries)', () => {
  const veronaMunichResponse = () => buildRoutingResponse([
    buildSection({ lengthMeters: 480000, durationSeconds: 7 * 3600, tollCountries: ['ITA', 'AUT', 'DEU'] }),
  ]);

  const payload = {
    origin: { address: 'Verona, Italy' },
    destination: { address: 'Munich, Germany' },
    vehicleProfileId: 'solo_18t_23ep',
  };

  it('passes normalized exclude[countries]=CHE to HERE and echoes it in debug', async () => {
    const routingUrls = installFetchMock(veronaMunichResponse());
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/quote',
      payload: { ...payload, excludeCountries: ['CH'] },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.quote.modelId).toBe('solo-europe');
    expect(body.debug.hereRequest.excludeCountries).toEqual(['CHE']);

    const url = new URL(routingUrls[0]);
    expect(url.searchParams.get('exclude[countries]')).toBe('CHE');
    // Other HERE params untouched
    expect(url.searchParams.get('return')).toBe('summary,tolls,polyline,actions');
    expect(url.searchParams.get('spans')).toBe('notices');
  });

  it('accepts mixed alpha-2/alpha-3/case input and deduplicates', async () => {
    const routingUrls = installFetchMock(veronaMunichResponse());
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/quote',
      payload: { ...payload, excludeCountries: ['CH', 'CHE', 'ch'] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().debug.hereRequest.excludeCountries).toEqual(['CHE']);
    expect(new URL(routingUrls[0]).searchParams.get('exclude[countries]')).toBe('CHE');
  });

  it('sends no exclude[countries] parameter when the field is absent', async () => {
    const routingUrls = installFetchMock(veronaMunichResponse());
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({ method: 'POST', url: '/api/quote', payload });
    expect(response.statusCode).toBe(200);
    expect(response.json().debug.hereRequest.excludeCountries).toEqual([]);
    expect(new URL(routingUrls[0]).searchParams.has('exclude[countries]')).toBe(false);
  });

  it('rejects unsupported codes with 400 before any HERE call', async () => {
    const routingUrls = installFetchMock(veronaMunichResponse());
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/quote',
      payload: { ...payload, excludeCountries: ['XX'] },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Unsupported exclude country code: XX');
    expect(routingUrls).toHaveLength(0);
  });

  it('rejects an excluded origin with 400 before calling HERE routing', async () => {
    const routingUrls = installFetchMock(veronaMunichResponse());
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/quote',
      payload: { ...payload, excludeCountries: ['IT'] }, // origin Verona is in Italy
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toBe('Origin cannot be in an excluded country.');
    expect(routingUrls).toHaveLength(0); // routing never called
  });

  it('rejects an excluded destination with 400 before calling HERE routing', async () => {
    const routingUrls = installFetchMock(veronaMunichResponse());
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/quote',
      payload: { ...payload, excludeCountries: ['DE'] }, // destination Munich is in Germany
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toBe('Destination cannot be in an excluded country.');
    expect(routingUrls).toHaveLength(0);
  });

  it('also passes exclude[countries] through /api/route-facts', async () => {
    const routingUrls = installFetchMock(veronaMunichResponse());
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/route-facts',
      payload: { ...payload, excludeCountries: 'CH, AT' }, // comma-string form
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().debug.hereRequest.excludeCountries).toEqual(['CHE', 'AUT']);
    expect(new URL(routingUrls[0]).searchParams.get('exclude[countries]')).toBe('CHE,AUT');
  });

  it('returns structured NO_ROUTE_FOUND when HERE finds no route under exclusions', async () => {
    installFetchMock({ routes: [] });
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/quote',
      payload: { ...payload, excludeCountries: ['CH'] },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error.code).toBe('NO_ROUTE_FOUND');
    expect(body.error.message).toContain('country exclusions');
  });
});

describe('Truck restriction segments (spans=notices)', () => {
  const RESTRICTION_POINTS = [
    { lat: 45.4384, lng: 10.9916 },
    { lat: 46.0, lng: 11.1 },
    { lat: 46.5, lng: 11.35 },
    { lat: 47.27, lng: 11.4 },
    { lat: 48.1374, lng: 11.5755 },
  ];

  function restrictionSection(withSpans: boolean) {
    const section = buildSection({
      lengthMeters: 430000,
      durationSeconds: 6 * 3600,
      tollCountries: ['ITA', 'AUT', 'DEU'],
      polyline: encodeFlexiblePolyline(RESTRICTION_POINTS, 5),
    });
    section.notices = [
      {
        title: 'Violated vehicle restriction.',
        code: 'violatedVehicleRestriction',
        severity: 'critical',
        details: [{ type: 'violatedVehicleRestriction', maxGrossWeight: 9000 }],
      },
    ];
    if (withSpans) {
      section.spans = [{ offset: 0 }, { offset: 2, notices: [0] }, { offset: 3 }];
    }
    return section;
  }

  const payload = {
    origin: { address: 'Verona, Italy' },
    destination: { address: 'Munich, Germany' },
    vehicleProfileId: 'solo_18t_23ep',
  };

  it('returns located restriction segments and sanitized debug preview', async () => {
    const routingUrls = installFetchMock(buildRoutingResponse([restrictionSection(true)]));
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({ method: 'POST', url: '/api/quote', payload });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    // Quote still calculated - restriction is a warning, not a failure
    expect(body.quote.modelId).toBe('solo-europe');

    const reg = body.routeFacts.regulatory;
    expect(reg.truckRestricted).toBe(true);
    expect(reg.restrictionReasons).toContain('Violated vehicle restriction.');
    expect(reg.restrictionSegments).toBeDefined();
    expect(reg.restrictionSegments.length).toBeGreaterThan(0);

    const seg = reg.restrictionSegments[0];
    expect(seg.code).toBe('violatedVehicleRestriction');
    expect(seg.severity).toBe('critical');
    expect(seg.spanStartOffset).toBe(2);
    expect(seg.spanEndOffset).toBe(3);
    // Segment coordinates come from the decoded polyline
    expect(seg.startPoint.lat).toBeCloseTo(46.5, 3);
    expect(seg.startPoint.lng).toBeCloseTo(11.35, 3);
    expect(seg.endPoint.lat).toBeCloseTo(47.27, 3);
    // Distance from origin computed and positive
    expect(seg.approxDistanceFromOriginKm).toBeGreaterThan(50);
    expect(seg.restrictionSummary).toBe('Maximum gross weight: 9000 kg');

    // Admissibility: critical violated segment -> route not valid for vehicle.
    // The quote object remains as a diagnostic figure, clearly not operational.
    expect(body.admissibility.status).toBe('truck_restricted');
    expect(body.admissibility.quoteValid).toBe(false);
    expect(body.admissibility.routeUsable).toBe(false);
    expect(body.admissibility.hardConstraintViolation).toBe(true);
    expect(body.admissibility.failedConstraints).toContain('vehicle_restriction');
    expect(body.admissibility.reason).toBe('Route found, but not valid for selected vehicle.');
    expect(body.quote.validForOperations).toBe(false);

    // Reverse-geocoded "near" location attached from the segment midpoint
    expect(seg.midPoint).toEqual({
      lat: Math.round(((46.5 + 47.27) / 2) * 100000) / 100000,
      lng: Math.round(((11.35 + 11.4) / 2) * 100000) / 100000,
    });
    expect(seg.location).not.toBeNull();
    expect(seg.location.label).toBe('Brennero, Trentino-South Tyrol, Italy');
    expect(seg.location.source).toBe('here_reverse_geocode');
    expect(revgeocodeUrls).toHaveLength(1);
    expect(body.debug.hereResponse.restrictionLocationLookups).toEqual({
      attempted: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
    });

    // Sanitized debug preview present
    expect(body.debug.hereResponse.restrictionSegmentsCount).toBe(1);
    expect(body.debug.hereResponse.restrictionSegmentsPreview).toHaveLength(1);
    expect(body.debug.hereResponse.restrictionSegmentsPreview[0].restrictionSummary)
      .toBe('Maximum gross weight: 9000 kg');
    expect(JSON.stringify(body)).not.toContain('test-api-key');

    // HERE request used spans=notices as separate param, not inside return
    const url = new URL(routingUrls[0]);
    expect(url.searchParams.get('spans')).toBe('notices');
    expect(url.searchParams.get('return')).toBe('summary,tolls,polyline,actions');
  });

  it('falls back to the generic warning when HERE provides no spans', async () => {
    installFetchMock(buildRoutingResponse([restrictionSection(false)]));
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({ method: 'POST', url: '/api/quote', payload });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    // Generic warning still works
    expect(body.routeFacts.regulatory.truckRestricted).toBe(true);
    expect(body.routeFacts.regulatory.restrictionReasons).toContain('Violated vehicle restriction.');
    // No located segments
    expect(body.routeFacts.regulatory.restrictionSegments).toBeUndefined();
    expect(body.debug.hereResponse.restrictionSegmentsCount).toBe(0);
    expect(body.debug.hereResponse.restrictionSegmentsPreview).toEqual([]);

    // Documented rule: a violatedVehicleRestriction notice WITHOUT span data
    // is still treated as truck_restricted (HERE explicitly flagged the
    // vehicle), with a message to verify the whole route manually.
    expect(body.admissibility.status).toBe('truck_restricted');
    expect(body.admissibility.quoteValid).toBe(false);
    expect(body.admissibility.messages.some((m: string) => m.includes('verify the whole route manually'))).toBe(true);
  });

  it('normalizes time-dependent restrictions: no encoded schedule in user-facing fields', async () => {
    const ENCODED = '++++*+(t1){d1}(h10){h13}';
    const section = buildSection({
      lengthMeters: 430000,
      durationSeconds: 6 * 3600,
      tollCountries: ['ITA', 'AUT', 'DEU'],
      polyline: encodeFlexiblePolyline(RESTRICTION_POINTS, 5),
    });
    section.notices = [
      {
        title: 'Violated vehicle restriction.',
        code: 'violatedVehicleRestriction',
        severity: 'critical',
        details: [{ type: 'violatedVehicleRestriction', restrictedTimes: ENCODED }],
      },
    ];
    section.spans = [{ offset: 0 }, { offset: 2, notices: [0] }, { offset: 3 }];
    installFetchMock(buildRoutingResponse([section]));
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({ method: 'POST', url: '/api/quote', payload });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    const seg = body.routeFacts.regulatory.restrictionSegments[0];

    // Normalized display is what the UI renders
    expect(seg.display.title).toBe('Time-dependent truck restriction');
    expect(seg.display.message).toBe(
      'Access may depend on date, time, tunnel rules or local traffic regulations. Manual verification required.'
    );
    expect(seg.display.severityLabel).toBe('critical');
    expect(seg.display.manualVerificationRequired).toBe(true);
    expect(seg.display.rawDetailsHidden).toBe(true);

    // No raw schedule syntax in ANY user-facing field
    expect(seg.display.title).not.toContain('++++*+');
    expect(seg.display.message).not.toContain('++++*+');
    expect(seg.restrictionSummary).toBe('Time-dependent restriction');
    expect(seg.restrictionSummary).not.toContain(ENCODED);
    expect(body.debug.hereResponse.restrictionSegmentsPreview[0].restrictionSummary)
      .not.toContain('++++*+');

    // Raw value may remain only in the internal details passthrough
    expect(JSON.stringify(seg.details)).toContain(ENCODED);

    // Admissibility unchanged by display normalization
    expect(body.admissibility.status).toBe('truck_restricted');
    expect(body.admissibility.quoteValid).toBe(false);
  });

  it('attaches gross-weight display to located segments', async () => {
    installFetchMock(buildRoutingResponse([restrictionSection(true)]));
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({ method: 'POST', url: '/api/quote', payload });
    expect(response.statusCode).toBe(200);
    const seg = response.json().routeFacts.regulatory.restrictionSegments[0];
    expect(seg.display.title).toBe('Maximum gross weight restriction');
    expect(seg.display.message).toContain('Limit: 9,000 kg');
    expect(seg.display.severityLabel).toBe('critical');
    expect(seg.display.rawDetailsHidden).toBe(false);
  });

  it('does not fail the quote when reverse geocoding of segment locations fails', async () => {
    installFetchMock(buildRoutingResponse([restrictionSection(true)]));
    revgeocodeFails = true;
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({ method: 'POST', url: '/api/quote', payload });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    // Segment still present, admissibility unchanged, only location missing
    expect(body.admissibility.status).toBe('truck_restricted');
    const seg = body.routeFacts.regulatory.restrictionSegments[0];
    expect(seg.location).toBeNull();
    expect(seg.startPoint).not.toBeNull();
    expect(body.debug.hereResponse.restrictionLocationLookups).toEqual({
      attempted: 1,
      succeeded: 0,
      failed: 1,
      skipped: 0,
    });
    // No key material anywhere despite the upstream failure
    expect(JSON.stringify(body)).not.toContain('test-api-key');
  });

  it('returns warning status for non-violated truck notices (quote stays valid)', async () => {
    const section = buildSection({
      lengthMeters: 430000,
      durationSeconds: 6 * 3600,
      tollCountries: ['ITA', 'AUT', 'DEU'],
    });
    section.notices = [
      { title: 'Height restriction ahead', code: 'truckRestriction', severity: 'info' },
    ];
    installFetchMock(buildRoutingResponse([section]));
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({ method: 'POST', url: '/api/quote', payload });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.admissibility.status).toBe('warning');
    expect(body.admissibility.quoteValid).toBe(true);
    expect(body.admissibility.routeUsable).toBe(true);
    expect(body.admissibility.hardConstraintViolation).toBe(false);
    expect(body.quote.validForOperations).toBe(true);
    expect(body.admissibility.messages[0]).toContain('Manual verification required');
  });

  it('never issues extra HERE routing calls for restricted routes (no baseline/fallback)', async () => {
    const routingUrls = installFetchMock(buildRoutingResponse([restrictionSection(true)]));
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/quote',
      payload: { ...payload, excludeCountries: ['CH'] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().admissibility.status).toBe('truck_restricted');
    // Exactly ONE routing request - the requested route under the user's
    // constraints. No baseline route ignoring exclusions, no candidates.
    expect(routingUrls).toHaveLength(1);
    expect(new URL(routingUrls[0]).searchParams.get('exclude[countries]')).toBe('CHE');
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
    expect(body.quote.modelId).toBe('solo-pl-europe');
    // (500 + 200) * 1.0 = 700 -> below the new 900 minimum -> 900
    expect(body.quote.lineItems.minimumAdjustment).toBe(200);
    expect(body.quote.finalPrice).toBe(900);
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
    // (500 + 200) * 1.0 = 700 -> below the 900 minimum -> 900
    expect(body.quote.finalPrice).toBe(900);
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
