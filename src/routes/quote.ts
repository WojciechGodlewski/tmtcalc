/**
 * POST /api/quote endpoint handler
 */

import { z } from 'zod/v4';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { HereService } from '../here/index.js';
import { extractRouteFactsFromHere } from '../here/extract-route-facts.js';
import { calculateQuote, type PricingResult, type QuoteOptions } from '../pricing/index.js';
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
 * Quote request body schema
 */
const QuoteRequestSchema = z.object({
  origin: LocationSchema,
  destination: LocationSchema,
  waypoints: z.array(LocationSchema).optional(),
  vehicleProfileId: VehicleProfileIdSchema,
  // Pricing options
  pricingDateTime: z.string().optional(),
  unloadingAfter14: z.boolean().optional(),
  isWeekend: z.boolean().optional(),
});

type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

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

interface QuoteResponse {
  quote: PricingResult;
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
  if (location.lat !== undefined && location.lng !== undefined) {
    return {
      lat: location.lat,
      lng: location.lng,
      source: 'provided',
    };
  }

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
 * Create quote route handler
 */
export function createQuoteHandler(hereService: HereService) {
  return async function quoteHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<QuoteResponse | ErrorResponse> {
    // Validate request body
    const parseResult = QuoteRequestSchema.safeParse(request.body);

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

      // Calculate quote
      const quoteOptions: QuoteOptions = {
        pricingDateTime: body.pricingDateTime,
        unloadingAfter14: body.unloadingAfter14,
        isWeekend: body.isWeekend,
      };

      const quote = calculateQuote(body.vehicleProfileId, routeFacts, quoteOptions);

      // Build response
      const resolvedPoints: ResolvedPoints = {
        origin: resolvedOrigin,
        destination: resolvedDestination,
      };

      if (resolvedWaypoints) {
        resolvedPoints.waypoints = resolvedWaypoints;
      }

      return {
        quote,
        routeFacts,
        debug: {
          resolvedPoints,
        },
      };
    } catch (error) {
      // Handle errors without leaking sensitive info
      const message = error instanceof Error ? error.message : 'Unknown error';

      // Sanitize message
      const sanitizedMessage = message
        .replace(/apiKey=[^&\s]+/gi, 'apiKey=***')
        .replace(/HERE_API_KEY/gi, '***');

      request.log.error({ error: sanitizedMessage }, 'Quote request failed');

      // Check if it's a "no model found" error (400) vs other errors (500)
      const isNoModelError = message.includes('No pricing model found');

      reply.status(isNoModelError ? 400 : 500);
      return {
        error: isNoModelError ? 'No pricing model available' : 'Failed to calculate quote',
        details: sanitizedMessage,
      };
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
