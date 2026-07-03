/**
 * POST /api/route-facts endpoint handler
 */

import { z } from 'zod/v4';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { HereService } from '../here/index.js';
import { extractRouteFactsFromHere } from '../here/extract-route-facts.js';
import type { RouteFacts } from '../types/route-facts.js';
import { ApiError, toApiError, type ApiErrorResponse } from '../errors.js';
import { applyResolvedGeography } from './geography.js';

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

interface PolylineInputDiagnostics {
  sections: Array<{
    idx: number;
    type: string;
    length: number | null;
    prefix: string | null;
  }>;
  chosenIdx: number | null;
  chosenLength: number | null;
  chosenPrefix: string | null;
  validPolylineCount: number;
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
  /** Diagnostics for polyline input extraction from HERE response */
  polylineInputDiagnostics: PolylineInputDiagnostics;
  /** Whether lat/lng swap was applied to fix European routes */
  polylineSwapApplied: boolean;
  /** First two points as decoded (before any fixes), for runtime debugging */
  decodedFirstTwoPointsBeforeFix: Array<{ lat: number; lng: number }> | null;
  /** First two points after all fixes (swap + lng patch), for runtime debugging */
  decodedFirstTwoPointsAfterFix: Array<{ lat: number; lng: number }> | null;
  /** Whether first point lng was patched due to corruption */
  firstPointLngPatched: boolean;
  /** Reason for first point lng patch: 'none' | 'patternMatch' | 'originDistanceGate' */
  firstPointLngPatchReason: 'none' | 'patternMatch' | 'originDistanceGate';
  /** Distance from origin to first decoded point before lng patch (km) */
  firstPointOriginDistanceKmBefore: number | null;
  /** Distance from origin to first decoded point after lng patch (km) */
  firstPointOriginDistanceKmAfter: number | null;
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

      // Extract RouteFacts, passing the Alps match from route-truck
      // (includes waypoint proximity detection when polyline decoding fails)
      const routeFacts = extractRouteFactsFromHere(
        routeResult.hereResponse,
        routeResult.debug.alpsMatch
      );

      // Populate geography (alpha-2 codes, isInternational, isEU,
      // countriesCrossed, riskFlags.isUK) from the resolved points
      applyResolvedGeography(
        routeFacts,
        resolvedOrigin.countryCode,
        resolvedDestination.countryCode
      );

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
            polylineInputDiagnostics: routeResult.debug.polylineInputDiagnostics,
            polylineSwapApplied: routeResult.debug.polylineSwapApplied,
            decodedFirstTwoPointsBeforeFix: routeResult.debug.decodedFirstTwoPointsBeforeFix,
            decodedFirstTwoPointsAfterFix: routeResult.debug.decodedFirstTwoPointsAfterFix,
            firstPointLngPatched: routeResult.debug.firstPointLngPatched,
            firstPointLngPatchReason: routeResult.debug.firstPointLngPatchReason,
            firstPointOriginDistanceKmBefore: routeResult.debug.firstPointOriginDistanceKmBefore,
            firstPointOriginDistanceKmAfter: routeResult.debug.firstPointOriginDistanceKmAfter,
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
