/**
 * POST /api/route-facts endpoint handler
 */

import { z } from 'zod/v4';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { HereService } from '../here/index.js';
import { extractRouteFactsFromHere } from '../here/extract-route-facts.js';
import type { RouteFacts } from '../types/route-facts.js';
import { ApiError, toApiError, type ApiErrorResponse } from '../errors.js';

/**
 * ISO 3166-1 alpha-3 to alpha-2 country code mapping
 */
const ALPHA3_TO_ALPHA2: Record<string, string> = {
  // EU member states
  AUT: 'AT', BEL: 'BE', BGR: 'BG', HRV: 'HR', CYP: 'CY',
  CZE: 'CZ', DNK: 'DK', EST: 'EE', FIN: 'FI', FRA: 'FR',
  DEU: 'DE', GRC: 'GR', HUN: 'HU', IRL: 'IE', ITA: 'IT',
  LVA: 'LV', LTU: 'LT', LUX: 'LU', MLT: 'MT', NLD: 'NL',
  POL: 'PL', PRT: 'PT', ROU: 'RO', SVK: 'SK', SVN: 'SI',
  ESP: 'ES', SWE: 'SE',
  // Non-EU European countries
  GBR: 'GB', NOR: 'NO', CHE: 'CH', ISL: 'IS', LIE: 'LI',
  // Additional commonly used
  UKR: 'UA', BLR: 'BY', MDA: 'MD', SRB: 'RS', MKD: 'MK',
  ALB: 'AL', MNE: 'ME', BIH: 'BA', XKX: 'XK', AND: 'AD',
  MCO: 'MC', SMR: 'SM', VAT: 'VA', TUR: 'TR', RUS: 'RU',
};

/**
 * Convert country code to ISO alpha-2 format
 * - Normalizes 'UK' to 'GB' (ISO standard)
 * - If already alpha-2 (2 chars), returns uppercase
 * - If alpha-3 (3 chars), converts using mapping
 * - Returns null if unknown
 */
function toAlpha2(countryCode: string | null): string | null {
  if (!countryCode) return null;

  const normalized = countryCode.toUpperCase().trim();

  // Special case: UK -> GB (ISO standard is GB for United Kingdom)
  if (normalized === 'UK') {
    return 'GB';
  }

  // Already alpha-2
  if (normalized.length === 2) {
    return normalized;
  }

  // Alpha-3 - convert to alpha-2
  if (normalized.length === 3) {
    const alpha2 = ALPHA3_TO_ALPHA2[normalized];
    if (alpha2) {
      return alpha2;
    }
    // Unknown alpha-3 code - log and return null
    console.debug(`Unknown alpha-3 country code: ${normalized}`);
    return null;
  }

  // Unknown format
  console.debug(`Invalid country code format: ${countryCode}`);
  return null;
}

/**
 * Check if a country code represents the United Kingdom
 * Handles GB, GBR, and UK variants
 */
function isUkCode(countryCode: string | null): boolean {
  if (!countryCode) return false;
  const normalized = countryCode.toUpperCase().trim();
  return normalized === 'GB' || normalized === 'GBR' || normalized === 'UK';
}

/**
 * EU member state country codes (ISO 3166-1 alpha-2)
 */
const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

/**
 * Check if a country is in the EU (expects alpha-2 code)
 */
function isEuCountry(countryCode: string | null): boolean {
  if (!countryCode) return false;
  // Already normalized to alpha-2
  return EU_COUNTRIES.has(countryCode);
}

/**
 * Location point - either address or coordinates required
 */
const LocationSchema = z.object({
  address: z.string().min(1).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
}).refine(
  (data) => data.address || (data.lat !== undefined && data.lng !== undefined),
  { message: 'Either address or both lat/lng coordinates are required' }
);

/**
 * Vehicle profile ID
 */
const VehicleProfileIdSchema = z.enum(['van_8ep', 'solo_18t_23ep', 'ftl_13_6_33ep']);

/**
 * Request body schema
 * Accepts either 'waypoints' or 'via' (via is an alias for waypoints)
 */
const RouteFactsRequestSchema = z.object({
  origin: LocationSchema,
  destination: LocationSchema,
  waypoints: z.array(LocationSchema).optional(),
  via: z.array(LocationSchema).optional(),
  vehicleProfileId: VehicleProfileIdSchema,
}).transform((data) => ({
  ...data,
  // Use 'via' if 'waypoints' is not provided, internally use 'waypoints'
  waypoints: data.waypoints ?? data.via,
}));

type RouteFactsRequest = z.infer<typeof RouteFactsRequestSchema>;

interface ResolvedPoint {
  lat: number;
  lng: number;
  label?: string;
  countryCode: string | null;
  source: 'provided' | 'geocoded';
}

interface ResolvedPoints {
  origin: ResolvedPoint;
  destination: ResolvedPoint;
  waypoints?: ResolvedPoint[];
}

interface HereRequestDebug {
  maskedUrl: string;
  via: Array<{ lat: number; lng: number }>;
  viaCount: number;
}

interface TunnelMatchDetail {
  matched: boolean;
  pointsInside: number;
  firstPoint?: { lat: number; lng: number };
  matchedByProximity?: boolean;
  closestDistanceKm?: number;
}

interface AlpsCenters {
  frejus: { lat: number; lng: number };
  montBlanc: { lat: number; lng: number };
}

interface AlpsBboxes {
  frejus: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  montBlanc: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}

interface AlpsCenterDistances {
  frejus: {
    fromOrigin?: number;
    fromWaypoints: number[];
    fromDestination?: number;
  };
  montBlanc: {
    fromOrigin?: number;
    fromWaypoints: number[];
    fromDestination?: number;
  };
}

type AlpsMatchReason = 'waypointProximity' | 'polylineBbox' | 'polylineDistance' | 'none';

interface WaypointProximityResult {
  frejus: boolean;
  montBlanc: boolean;
  reasons: {
    frejus: AlpsMatchReason;
    montBlanc: AlpsMatchReason;
  };
}

interface HereResponseDebug {
  sectionsCount: number;
  actionsCountTotal: number;
  polylinePointsChecked: number;
  alpsMatch: {
    frejus: boolean;
    montBlanc: boolean;
  };
  alpsMatchDetails: {
    frejus: TunnelMatchDetail;
    montBlanc: TunnelMatchDetail;
  };
  /** Polyline bounds (flattened from polylineSanity) */
  polylineBounds: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null;
  polylineFirstPoint: { lat: number; lng: number } | null;
  polylineLastPoint: { lat: number; lng: number } | null;
  /** Whether polyline bounds are plausible (within Earth coordinate ranges) */
  polylineBoundsPlausible: boolean;
  /** Waypoint proximity detection result */
  waypointProximity: WaypointProximityResult;
  /** Final match reason for Alps detection */
  alpsMatchReason: {
    frejus: AlpsMatchReason;
    montBlanc: AlpsMatchReason;
  };
  samples: string[];
}

interface AlpsConfig {
  centers: AlpsCenters;
  bboxes: AlpsBboxes;
}

interface RouteFactsResponse {
  routeFacts: RouteFacts;
  debug: {
    resolvedPoints: ResolvedPoints;
    hereRequest: HereRequestDebug;
    hereResponse: HereResponseDebug;
    /** Alps tunnel detection configuration */
    alpsConfig: AlpsConfig;
    /** Distances from origin/waypoints/destination to tunnel centers */
    alpsCenterDistances: AlpsCenterDistances;
  };
}

/**
 * Resolve a location point to coordinates and country code
 */
async function resolvePoint(
  hereService: HereService,
  location: { address?: string; lat?: number; lng?: number }
): Promise<ResolvedPoint> {
  // If coordinates are provided, use them directly
  if (location.lat !== undefined && location.lng !== undefined) {
    // Use reverse geocoding to get the country code
    const reverseResult = await hereService.reverseGeocode(location.lat, location.lng);
    return {
      lat: location.lat,
      lng: location.lng,
      label: reverseResult.label || undefined,
      countryCode: reverseResult.countryCode,
      source: 'provided',
    };
  }

  // Geocode the address
  if (location.address) {
    const result = await hereService.geocode(location.address);
    return {
      lat: result.lat,
      lng: result.lng,
      label: result.label,
      countryCode: result.countryCode,
      source: 'geocoded',
    };
  }

  throw new Error('Either address or coordinates must be provided');
}

/**
 * Create route-facts route handler
 */
export function createRouteFactsHandler(hereService: HereService) {
  return async function routeFactsHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<RouteFactsResponse | ApiErrorResponse> {
    // Validate request body
    const parseResult = RouteFactsRequestSchema.safeParse(request.body);

    if (!parseResult.success) {
      const validationError = new ApiError(
        'VALIDATION_ERROR',
        'Invalid request body',
        400,
        parseResult.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }))
      );
      reply.status(400);
      return validationError.toResponse();
    }

    const body = parseResult.data;

    try {
      // Resolve all points to coordinates
      const [resolvedOrigin, resolvedDestination] = await Promise.all([
        resolvePoint(hereService, body.origin),
        resolvePoint(hereService, body.destination),
      ]);

      // Resolve waypoints if provided
      let resolvedWaypoints: ResolvedPoint[] | undefined;
      if (body.waypoints && body.waypoints.length > 0) {
        resolvedWaypoints = await Promise.all(
          body.waypoints.map((wp) => resolvePoint(hereService, wp))
        );
      }

      // Call HERE routing
      const routeResult = await hereService.routeTruck({
        origin: { lat: resolvedOrigin.lat, lng: resolvedOrigin.lng },
        destination: { lat: resolvedDestination.lat, lng: resolvedDestination.lng },
        waypoints: resolvedWaypoints?.map((wp) => ({ lat: wp.lat, lng: wp.lng })),
        vehicleProfileId: body.vehicleProfileId,
      });

      // Extract RouteFacts
      const routeFacts = extractRouteFactsFromHere(routeResult.hereResponse);

      // Populate geography with country info from resolved points
      // Convert to alpha-2 for consistent format in routeFacts
      const originCountry = toAlpha2(resolvedOrigin.countryCode);
      const destinationCountry = toAlpha2(resolvedDestination.countryCode);

      routeFacts.geography.originCountry = originCountry;
      routeFacts.geography.destinationCountry = destinationCountry;

      // Determine if route is international
      if (originCountry && destinationCountry) {
        routeFacts.geography.isInternational = originCountry !== destinationCountry;
      }

      // Determine if route is within EU
      if (originCountry && destinationCountry) {
        const originIsEU = isEuCountry(originCountry);
        const destIsEU = isEuCountry(destinationCountry);
        // isEU is true if both endpoints are in EU countries
        routeFacts.geography.isEU = originIsEU && destIsEU;
      }

      // Normalize all countriesCrossed to alpha-2, add origin/destination
      const countriesSet = new Set<string>();
      // Convert existing countries (from tolls) to alpha-2
      for (const code of routeFacts.geography.countriesCrossed) {
        const alpha2 = toAlpha2(code);
        if (alpha2) countriesSet.add(alpha2);
      }
      // Add origin and destination
      if (originCountry) countriesSet.add(originCountry);
      if (destinationCountry) countriesSet.add(destinationCountry);
      routeFacts.geography.countriesCrossed = Array.from(countriesSet);

      // Update riskFlags.isUK based on normalized country codes
      // Check destination and all countries crossed
      const hasUkInRoute = isUkCode(destinationCountry) ||
        routeFacts.geography.countriesCrossed.some(isUkCode);
      routeFacts.riskFlags.isUK = hasUkInRoute;

      // Build response
      const resolvedPoints: ResolvedPoints = {
        origin: resolvedOrigin,
        destination: resolvedDestination,
      };

      if (resolvedWaypoints) {
        resolvedPoints.waypoints = resolvedWaypoints;
      }

      return {
        routeFacts,
        debug: {
          resolvedPoints,
          hereRequest: {
            maskedUrl: routeResult.debug.maskedUrl,
            via: routeResult.debug.via,
            viaCount: routeResult.debug.viaCount,
          },
          hereResponse: {
            sectionsCount: routeResult.debug.sectionsCount,
            actionsCountTotal: routeResult.debug.actionsCountTotal,
            polylinePointsChecked: routeResult.debug.polylinePointsChecked,
            alpsMatch: routeResult.debug.alpsMatch,
            alpsMatchDetails: routeResult.debug.alpsMatchDetails,
            polylineBounds: routeResult.debug.polylineSanity.polylineBounds,
            polylineFirstPoint: routeResult.debug.polylineSanity.polylineFirstPoint,
            polylineLastPoint: routeResult.debug.polylineSanity.polylineLastPoint,
            polylineBoundsPlausible: routeResult.debug.polylineBoundsPlausible,
            waypointProximity: routeResult.debug.waypointProximity,
            alpsMatchReason: routeResult.debug.alpsMatchReason,
            samples: routeResult.debug.samples,
          },
          alpsConfig: routeResult.debug.alpsConfig,
          alpsCenterDistances: routeResult.debug.alpsCenterDistances,
        },
      };
    } catch (error) {
      // Convert to standardized API error
      const apiError = toApiError(error);

      request.log.error({ error: apiError.message }, 'Route facts request failed');

      reply.status(apiError.statusCode);
      return apiError.toResponse();
    }
  };
}

/**
 * Register route-facts routes
 */
export function registerRouteFactsRoutes(app: FastifyInstance, hereService: HereService) {
  const handler = createRouteFactsHandler(hereService);

  app.post('/api/route-facts', handler);
}
