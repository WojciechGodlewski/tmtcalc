/**
 * POST /api/quote endpoint handler
 */

import { z } from 'zod/v4';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { HereService } from '../here/index.js';
import { extractRouteFactsFromHere } from '../here/extract-route-facts.js';
import { calculateQuote, type PricingResult, type QuoteOptions } from '../pricing/index.js';
import type { RouteFacts } from '../types/route-facts.js';
import { ApiError, toApiError, type ApiErrorResponse } from '../errors.js';
import { applyResolvedGeography, toAlpha2 } from './geography.js';
import { normalizeExcludeCountries, excludedAlpha2Set } from './exclude-countries.js';
import { evaluateAdmissibility, type Admissibility } from './admissibility.js';
import { buildRestrictionDebug, type RestrictionSegmentPreview } from './restriction-debug.js';
import { buildRouteGeometry, type RouteGeometry } from './route-geometry.js';

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
 * Quote request body schema
 * Accepts either 'waypoints' or 'via' (via is an alias for waypoints)
 */
const QuoteRequestSchema = z.object({
  origin: LocationSchema,
  destination: LocationSchema,
  waypoints: z.array(LocationSchema).optional(),
  via: z.array(LocationSchema).optional(),
  vehicleProfileId: VehicleProfileIdSchema,
  // Pricing options
  pricingDateTime: z.string().optional(),
  unloadingAfter14: z.boolean().optional(),
  isWeekend: z.boolean().optional(),
  // When true, include decoded route geometry (for map display) in the response
  includeGeometry: z.boolean().optional(),
  // Strict country exclusion: array of codes or comma-separated string
  excludeCountries: z.union([z.array(z.string()), z.string()]).optional(),
}).transform((data) => ({
  ...data,
  // Use 'via' if 'waypoints' is not provided, internally use 'waypoints'
  waypoints: data.waypoints ?? data.via,
}));

type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

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
  /** Normalized alpha-3 codes sent to HERE as exclude[countries] */
  excludeCountries: string[];
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
  /** Number of located truck restriction segments */
  restrictionSegmentsCount: number;
  /** Compact sanitized preview of restriction segments (max 5) */
  restrictionSegmentsPreview: RestrictionSegmentPreview[];
}

interface AlpsConfig {
  centers: AlpsCenters;
  bboxes: AlpsBboxes;
}

interface QuoteResponse {
  /** Source of truth for route/quote validity - see src/routes/admissibility.ts */
  admissibility: Admissibility;
  /**
   * Pricing breakdown. Present whenever a pricing model exists (also for
   * truck_restricted routes, as a diagnostic/indicative figure); absent when
   * status is pricing_unavailable. validForOperations mirrors
   * admissibility.quoteValid.
   */
  quote?: PricingResult & { validForOperations: boolean };
  routeFacts: RouteFacts;
  /** Present only when the request sets includeGeometry: true */
  routeGeometry?: RouteGeometry;
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
  // If coordinates are provided, use reverse geocoding to get country
  if (location.lat !== undefined && location.lng !== undefined) {
    const reverseResult = await hereService.reverseGeocode(location.lat, location.lng);
    return {
      lat: location.lat,
      lng: location.lng,
      label: reverseResult.label || undefined,
      countryCode: reverseResult.countryCode,
      source: 'provided',
    };
  }

  // Geocode the address (includes country code)
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
 * Create quote route handler
 */
export function createQuoteHandler(hereService: HereService) {
  return async function quoteHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<QuoteResponse | ApiErrorResponse> {
    // Validate request body
    const parseResult = QuoteRequestSchema.safeParse(request.body);

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
      // Normalize strict country exclusions (throws 400 on unsupported codes)
      const excludeCountries = normalizeExcludeCountries(body.excludeCountries);
      const excludedAlpha2 = excludedAlpha2Set(excludeCountries);

      // Resolve all points to coordinates
      const [resolvedOrigin, resolvedDestination] = await Promise.all([
        resolvePoint(hereService, body.origin),
        resolvePoint(hereService, body.destination),
      ]);

      // Strict exclusion sanity checks - fail BEFORE calling HERE routing
      if (excludedAlpha2.size > 0) {
        const originAlpha2 = toAlpha2(resolvedOrigin.countryCode);
        const destAlpha2 = toAlpha2(resolvedDestination.countryCode);
        if (originAlpha2 && excludedAlpha2.has(originAlpha2)) {
          throw new ApiError('VALIDATION_ERROR', 'Origin cannot be in an excluded country.', 400);
        }
        if (destAlpha2 && excludedAlpha2.has(destAlpha2)) {
          throw new ApiError('VALIDATION_ERROR', 'Destination cannot be in an excluded country.', 400);
        }
      }

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
        ...(excludeCountries.length > 0 ? { excludeCountries } : {}),
      });

      // HERE returned no route at all (can happen with strict exclusions)
      if (!routeResult.hereResponse.routes || routeResult.hereResponse.routes.length === 0) {
        throw new ApiError(
          'NO_ROUTE_FOUND',
          excludeCountries.length > 0
            ? 'No route found between origin and destination with the selected country exclusions.'
            : 'No route found between origin and destination.',
          422
        );
      }

      // Extract RouteFacts, passing the Alps match from route-truck
      // (includes waypoint proximity detection when polyline decoding fails)
      const routeFacts = extractRouteFactsFromHere(
        routeResult.hereResponse,
        routeResult.debug.alpsMatch
      );

      // Populate geography (alpha-2 codes, isInternational, isEU,
      // countriesCrossed, riskFlags.isUK) from the resolved points.
      // The pricing model selector consumes this same geography.
      applyResolvedGeography(
        routeFacts,
        resolvedOrigin.countryCode,
        resolvedDestination.countryCode
      );

      // Calculate quote
      const quoteOptions: QuoteOptions = {
        pricingDateTime: body.pricingDateTime,
        unloadingAfter14: body.unloadingAfter14,
        isWeekend: body.isWeekend,
      };

      // Compute pricing. A missing pricing model is NOT an error anymore -
      // it becomes admissibility.status = 'pricing_unavailable' so the route
      // and map remain available. Other pricing errors still propagate.
      let pricingResult: PricingResult | undefined;
      let pricingModelFound = true;
      try {
        pricingResult = calculateQuote(body.vehicleProfileId, routeFacts, quoteOptions);
      } catch (pricingError) {
        const message = pricingError instanceof Error ? pricingError.message : '';
        if (message.includes('No pricing model found')) {
          pricingModelFound = false;
        } else {
          throw pricingError;
        }
      }

      // Admissibility is the source of truth for route/quote validity.
      // Only the requested route is evaluated - no baseline or fallback
      // routes are ever calculated.
      const admissibility = evaluateAdmissibility({
        routeFacts,
        excludeCountries,
        pricingModelFound,
      });

      const quote = pricingResult
        ? { ...pricingResult, validForOperations: admissibility.quoteValid }
        : undefined;

      // Optional route geometry for map display, from the corrected decoded
      // polyline. Omitted entirely unless includeGeometry: true is requested.
      let routeGeometry: RouteGeometry | undefined;
      if (body.includeGeometry) {
        routeGeometry = buildRouteGeometry(routeResult.polylinePoints) ?? undefined;
      }

      // Build response
      const resolvedPoints: ResolvedPoints = {
        origin: resolvedOrigin,
        destination: resolvedDestination,
      };

      if (resolvedWaypoints) {
        resolvedPoints.waypoints = resolvedWaypoints;
      }

      return {
        admissibility,
        ...(quote ? { quote } : {}),
        routeFacts,
        ...(routeGeometry ? { routeGeometry } : {}),
        debug: {
          resolvedPoints,
          hereRequest: {
            maskedUrl: routeResult.debug.maskedUrl,
            via: routeResult.debug.via,
            viaCount: routeResult.debug.viaCount,
            excludeCountries,
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
            ...buildRestrictionDebug(routeFacts.regulatory.restrictionSegments),
          },
          alpsConfig: routeResult.debug.alpsConfig,
          alpsCenterDistances: routeResult.debug.alpsCenterDistances,
        },
      };
    } catch (error) {
      // Convert to standardized API error
      const apiError = toApiError(error);

      request.log.error({ error: apiError.message }, 'Quote request failed');

      reply.status(apiError.statusCode);
      return apiError.toResponse();
    }
  };
}

/**
 * Register quote routes
 */
export function registerQuoteRoutes(app: FastifyInstance, hereService: HereService) {
  const handler = createQuoteHandler(hereService);

  app.post('/api/quote', handler);
}
