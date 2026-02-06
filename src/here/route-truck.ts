/**
 * HERE Routing API v8 integration for truck routing
 * https://developer.here.com/documentation/routing-api/dev_guide/index.html
 */

import { type HereClient } from './http-client.js';
import { getVehicleProfile, type VehicleProfileId } from './vehicle-profiles.js';

const ROUTING_API_URL = 'https://router.hereapi.com/v8/routes';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface RouteTruckParams {
  origin: Coordinates;
  destination: Coordinates;
  waypoints?: Coordinates[];
  vehicleProfileId: VehicleProfileId;
}

export interface RouteDebugInfo {
  maskedUrl: string;
  via: Array<{ lat: number; lng: number }>;
  viaCount: number;
  actionsSample: string[];
}

export interface RouteTruckResult {
  hereResponse: HereRoutingResponse;
  debug: RouteDebugInfo;
}

// HERE Routing API response types
export interface HereRoutingResponse {
  routes: HereRoute[];
}

export interface HereRoute {
  id: string;
  sections: HereRouteSection[];
}

export interface HereRouteSection {
  id: string;
  type: string;
  departure: HereRoutePlace;
  arrival: HereRoutePlace;
  summary: HereRouteSummary;
  transport: HereTransport;
  actions?: HereRouteAction[];
  tolls?: HereTollInfo[];
  notices?: HereNotice[];
}

export interface HereRoutePlace {
  time: string;
  place: {
    type: string;
    location: {
      lat: number;
      lng: number;
    };
    originalLocation?: {
      lat: number;
      lng: number;
    };
  };
}

export interface HereRouteSummary {
  duration: number;
  length: number;
  baseDuration: number;
  typicalDuration?: number;
}

export interface HereTransport {
  mode: string;
}

export interface HereRouteAction {
  action: string;
  duration: number;
  length: number;
  instruction: string;
  offset: number;
  direction?: string;
  severity?: string;
}

export interface HereTollInfo {
  tolls: HereToll[];
}

export interface HereToll {
  countryCode: string;
  tollSystem: string;
  tollCollectionLocations?: Array<{
    name?: string;
    location: {
      lat: number;
      lng: number;
    };
  }>;
  fares?: Array<{
    id: string;
    name?: string;
    price: {
      type: string;
      value: string;
      currency: string;
    };
    paymentMethods?: string[];
  }>;
}

export interface HereNotice {
  title: string;
  code: string;
  severity: string;
}

/**
 * Format coordinates for HERE API
 */
function formatCoords(coords: Coordinates): string {
  return `${coords.lat},${coords.lng}`;
}

/**
 * Build masked URL for debug logging (no API key)
 */
function buildMaskedUrl(
  baseUrl: string,
  params: Record<string, string | number | boolean | undefined>,
  viaStrings: string[]
): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      searchParams.set(key, String(value));
    }
  }

  // Add via params
  for (const via of viaStrings) {
    searchParams.append('via', via);
  }

  return baseUrl + '?' + searchParams.toString();
}

/**
 * Collect action strings from HERE response for tunnel detection debug
 * Returns up to 20 strings from actions[].instruction
 */
function collectActionsSample(response: HereRoutingResponse): string[] {
  const sample: string[] = [];
  const MAX_SAMPLE = 20;

  if (!response.routes || response.routes.length === 0) {
    return sample;
  }

  for (const route of response.routes) {
    if (!route.sections) continue;

    for (const section of route.sections) {
      if (!section.actions) continue;

      for (const action of section.actions) {
        if (sample.length >= MAX_SAMPLE) break;

        // Collect instruction text
        if (action.instruction) {
          sample.push(action.instruction);
        }
      }

      if (sample.length >= MAX_SAMPLE) break;
    }

    if (sample.length >= MAX_SAMPLE) break;
  }

  return sample;
}

/**
 * Create truck routing function
 */
export function createTruckRouter(client: HereClient) {
  /**
   * Calculate truck route between origin and destination
   * @param params Route parameters including vehicle profile
   * @returns HERE routing response with route details and debug info
   * @throws HereApiError on API errors
   */
  async function routeTruck(params: RouteTruckParams): Promise<RouteTruckResult> {
    const { origin, destination, waypoints = [], vehicleProfileId } = params;

    // Get vehicle profile
    const profile = getVehicleProfile(vehicleProfileId);

    // Build via parameter for waypoints - use passThrough=true to force passing through
    // HERE v8 format: via=lat,lng!passThrough=true
    const viaStrings = waypoints.map((wp) => `${wp.lat},${wp.lng}!passThrough=true`);

    // Build request params using vehicle[...] parameters (Routing API v8)
    // Note: Do NOT mix truck[...] and vehicle[...] params - use only vehicle[...]
    const requestParams: Record<string, string | number | boolean | undefined> = {
      transportMode: 'truck',
      origin: formatCoords(origin),
      destination: formatCoords(destination),
      return: 'summary,tolls,polyline,actions',
      // Vehicle dimensions (in cm) and weight (in kg)
      'vehicle[grossWeight]': profile.grossWeight,
      'vehicle[height]': profile.heightCm,
      'vehicle[width]': profile.widthCm,
      'vehicle[length]': profile.lengthCm,
      'vehicle[axleCount]': profile.axleCount,
    };

    // Build multi-params for via points (same key repeated)
    const multiParams: Record<string, string[]> = {};
    if (viaStrings.length > 0) {
      multiParams.via = viaStrings;
    }

    // Build masked URL for debug
    const maskedUrl = buildMaskedUrl(ROUTING_API_URL, requestParams, viaStrings);

    // Make API request
    const response = await client.request<HereRoutingResponse>(ROUTING_API_URL, {
      params: requestParams,
      multiParams: Object.keys(multiParams).length > 0 ? multiParams : undefined,
    });

    // Collect actions sample for debug
    const actionsSample = collectActionsSample(response);

    return {
      hereResponse: response,
      debug: {
        maskedUrl,
        via: waypoints,
        viaCount: waypoints.length,
        actionsSample,
      },
    };
  }

  return { routeTruck };
}

export type TruckRouter = ReturnType<typeof createTruckRouter>;
