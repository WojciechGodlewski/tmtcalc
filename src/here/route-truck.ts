/**
 * HERE Routing API v8 integration for truck routing
 * https://developer.here.com/documentation/routing-api/dev_guide/index.html
 */

import { type HereClient } from './http-client.js';
import { getVehicleProfile, type VehicleProfileId } from './vehicle-profiles.js';
import {
  decodeFlexiblePolyline,
  checkAlpsTunnels,
  type AlpsTunnelCheckResult,
} from './flexible-polyline.js';

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
  sectionsCount: number;
  actionsCountTotal: number;
  /** Number of polyline points checked for Alps tunnel detection */
  polylinePointsChecked: number;
  /** Alps tunnel bbox match results */
  alpsMatch: {
    frejus: boolean;
    montBlanc: boolean;
  };
  /** Sample strings from actions for debugging */
  samples: string[];
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
  /** Encoded flexible polyline for the section */
  polyline?: string;
  actions?: HereRouteAction[];
  spans?: HereRouteSpan[];
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
  /** Road name when present (e.g., for enter/continue actions) */
  currentRoad?: { name?: string[] };
  /** Next road name when present (e.g., for turn actions) */
  nextRoad?: { name?: string[] };
}

/**
 * HERE Routing API v8 Span
 * Spans contain detailed road segment info including tunnel indicators
 */
export interface HereRouteSpan {
  /** Offset index in polyline */
  offset: number;
  /** Road names for this span */
  names?: Array<{ value: string; language?: string }>;
  /** Length in meters */
  length?: number;
  /** Dynamic speed info */
  dynamicSpeedInfo?: { baseSpeed: number; trafficSpeed: number };
  /** Segment reference */
  segmentRef?: string;
  /** Functional class */
  functionalClass?: number;
  /** Route numbers (e.g., "A32", "E70") */
  routeNumbers?: string[];
  /** Speed limit */
  speedLimit?: number;
  /** Maximum speed */
  maxSpeed?: number;
  /** Country code */
  countryCode?: string;
  /** Indicates if span is a tunnel */
  tunnel?: boolean;
  /** Street category attributes */
  streetAttributes?: string[];
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
 * Collect debug telemetry counts from HERE response
 */
function collectTelemetryCounts(response: HereRoutingResponse): {
  sectionsCount: number;
  actionsCountTotal: number;
} {
  let sectionsCount = 0;
  let actionsCountTotal = 0;

  if (!response.routes || response.routes.length === 0) {
    return { sectionsCount, actionsCountTotal };
  }

  for (const route of response.routes) {
    if (!route.sections) continue;
    sectionsCount += route.sections.length;

    for (const section of route.sections) {
      if (section.actions) {
        actionsCountTotal += section.actions.length;
      }
    }
  }

  return { sectionsCount, actionsCountTotal };
}

/**
 * Check all section polylines for Alps tunnel bbox matches
 */
function checkPolylineForAlpsTunnels(response: HereRoutingResponse): AlpsTunnelCheckResult {
  let totalPointsChecked = 0;
  let frejusMatch = false;
  let montBlancMatch = false;

  if (!response.routes || response.routes.length === 0) {
    return { frejus: false, montBlanc: false, pointsChecked: 0 };
  }

  for (const route of response.routes) {
    if (!route.sections) continue;

    for (const section of route.sections) {
      if (!section.polyline) continue;

      try {
        const points = decodeFlexiblePolyline(section.polyline);
        const result = checkAlpsTunnels(points);

        totalPointsChecked += result.pointsChecked;
        if (result.frejus) frejusMatch = true;
        if (result.montBlanc) montBlancMatch = true;

        // Early exit if both found
        if (frejusMatch && montBlancMatch) {
          return {
            frejus: true,
            montBlanc: true,
            pointsChecked: totalPointsChecked,
          };
        }
      } catch {
        // Ignore polyline decode errors, continue with other sections
      }
    }
  }

  return {
    frejus: frejusMatch,
    montBlanc: montBlancMatch,
    pointsChecked: totalPointsChecked,
  };
}

/**
 * Collect sample strings from HERE response for debugging
 * Returns up to 30 strings from actions
 */
function collectSamples(response: HereRoutingResponse): string[] {
  const sample: string[] = [];
  const MAX_SAMPLE = 30;

  if (!response.routes || response.routes.length === 0) {
    return sample;
  }

  for (const route of response.routes) {
    if (!route.sections) continue;

    for (const section of route.sections) {
      // Collect from actions
      if (section.actions) {
        for (const action of section.actions) {
          if (sample.length >= MAX_SAMPLE) break;

          // Collect instruction text
          if (action.instruction) {
            sample.push(`action:instruction:${action.instruction}`);
          }

          // Collect road names from actions
          if (action.currentRoad?.name) {
            for (const name of action.currentRoad.name) {
              if (sample.length >= MAX_SAMPLE) break;
              sample.push(`action:currentRoad:${name}`);
            }
          }
          if (action.nextRoad?.name) {
            for (const name of action.nextRoad.name) {
              if (sample.length >= MAX_SAMPLE) break;
              sample.push(`action:nextRoad:${name}`);
            }
          }
        }
      }
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

    // Collect telemetry for debug
    const telemetry = collectTelemetryCounts(response);
    const alpsCheck = checkPolylineForAlpsTunnels(response);
    const samples = collectSamples(response);

    return {
      hereResponse: response,
      debug: {
        maskedUrl,
        via: waypoints,
        viaCount: waypoints.length,
        sectionsCount: telemetry.sectionsCount,
        actionsCountTotal: telemetry.actionsCountTotal,
        polylinePointsChecked: alpsCheck.pointsChecked,
        alpsMatch: {
          frejus: alpsCheck.frejus,
          montBlanc: alpsCheck.montBlanc,
        },
        samples,
      },
    };
  }

  return { routeTruck };
}

export type TruckRouter = ReturnType<typeof createTruckRouter>;
