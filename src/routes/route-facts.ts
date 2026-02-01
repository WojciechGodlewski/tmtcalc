/**
 * POST /api/route-facts endpoint handler
 */

import { z } from 'zod/v4';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { HereService } from '../here/index.js';
import { extractRouteFactsFromHere } from '../here/extract-route-facts.js';
import type { RouteFacts } from '../types/route-facts.js';

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

interface ErrorResponse {
  error: string;
  details?: unknown;
}

/**
 * Resolve a location point to coordinates
 */
async function resolvePoint(
  hereService: HereService,
  location: { address?: string; lat?: number; lng?: number }
): Promise<ResolvedPoint> {
  // If coordinates are provided, use them directly
  if (location.lat !== undefined && location.lng !== undefined) {
    return {
      lat: location.lat,
      lng: location.lng,
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
  ): Promise<RouteFactsResponse | ErrorResponse> {
    // Validate request body
    const parseResult = RouteFactsRequestSchema.safeParse(request.body);

    if (!parseResult.success) {
      reply.status(400);
      return {
        error: 'Invalid request body',
        details: parseResult.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      };
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
      // Handle errors without leaking sensitive info
      const message = error instanceof Error ? error.message : 'Unknown error';

      // Sanitize message to ensure no API key leaks
      const sanitizedMessage = message
        .replace(/apiKey=[^&\s]+/gi, 'apiKey=***')
        .replace(/HERE_API_KEY/gi, '***');

      request.log.error({ error: sanitizedMessage }, 'Route facts request failed');

      reply.status(500);
      return {
        error: 'Failed to calculate route',
        details: sanitizedMessage,
      };
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
