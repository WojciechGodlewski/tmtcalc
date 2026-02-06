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
 * EU member state country codes (ISO 3166-1 alpha-3)
 */
const EU_COUNTRIES = new Set([
  'AUT', 'BEL', 'BGR', 'HRV', 'CYP', 'CZE', 'DNK', 'EST', 'FIN', 'FRA',
  'DEU', 'GRC', 'HUN', 'IRL', 'ITA', 'LVA', 'LTU', 'LUX', 'MLT', 'NLD',
  'POL', 'PRT', 'ROU', 'SVK', 'SVN', 'ESP', 'SWE',
]);

/**
 * Check if a country is in the EU
 */
function isEuCountry(countryCode: string | null): boolean {
  if (!countryCode) return false;
  return EU_COUNTRIES.has(countryCode.toUpperCase());
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
 */
const RouteFactsRequestSchema = z.object({
  origin: LocationSchema,
  destination: LocationSchema,
  waypoints: z.array(LocationSchema).optional(),
  vehicleProfileId: VehicleProfileIdSchema,
});

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

interface RouteFactsResponse {
  routeFacts: RouteFacts;
  debug: {
    resolvedPoints: ResolvedPoints;
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
      const originCountry = resolvedOrigin.countryCode;
      const destinationCountry = resolvedDestination.countryCode;

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

      // Add origin/destination countries to countriesCrossed if not already present
      const countriesSet = new Set(routeFacts.geography.countriesCrossed);
      if (originCountry) countriesSet.add(originCountry);
      if (destinationCountry) countriesSet.add(destinationCountry);
      routeFacts.geography.countriesCrossed = Array.from(countriesSet);

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
