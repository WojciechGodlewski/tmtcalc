/**
 * HERE Routing API v8 integration for truck routing
 * https://developer.here.com/documentation/routing-api/dev_guide/index.html
 */

import { type HereClient } from './http-client.js';
import { getVehicleProfile, type VehicleProfileId } from './vehicle-profiles.js';
import {
  decodeFlexiblePolyline,
  checkAlpsTunnels,
  computePolylineSanityStats,
  getAlpsDebugConfig,
  computeAlpsCenterDistances,
  checkWaypointProximity,
  arePolylineBoundsPlausible,
  type AlpsTunnelCheckResult,
  type TunnelMatchDetails,
  type PolylineSanityStats,
  type AlpsDebugConfig,
  type AlpsCenterDistances,
  type AlpsMatchReason,
  type WaypointProximityResult,
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
  /** Detailed Alps tunnel match diagnostics */
  alpsMatchDetails: {
    frejus: TunnelMatchDetails;
    montBlanc: TunnelMatchDetails;
  };
  /** Alps tunnel detection configuration (centers and bboxes) */
  alpsConfig: AlpsDebugConfig;
  /** Distances from origin/waypoints/destination to tunnel centers */
  alpsCenterDistances: AlpsCenterDistances;
  /** Sample strings from actions for debugging */
  samples: string[];
  /** Polyline sanity stats for debugging decoder output */
  polylineSanity: PolylineSanityStats;
  /** Waypoint proximity detection result */
  waypointProximity: WaypointProximityResult;
  /** Whether polyline bounds were plausible (used for deciding detection method) */
  polylineBoundsPlausible: boolean;
  /** Final match reason for each tunnel (combining polyline and waypoint methods) */
  alpsMatchReason: {
    frejus: AlpsMatchReason;
    montBlanc: AlpsMatchReason;
  };
  /** Diagnostics for polyline input extraction from HERE response */
  polylineInputDiagnostics: PolylineInputDiagnostics;
  /** Whether lat/lng swap was applied to fix European routes */
  polylineSwapApplied: boolean;
}

/**
 * Diagnostics for polyline extraction from HERE response sections
 */
export interface PolylineInputDiagnostics {
  /** Info about each section's polyline field */
  sections: Array<{
    idx: number;
    type: string;
    length: number | null;
    prefix: string | null;
  }>;
  /** Index of chosen section (longest polyline) or null if none */
  chosenIdx: number | null;
  /** Length of chosen polyline string */
  chosenLength: number | null;
  /** First 60 chars of chosen polyline */
  chosenPrefix: string | null;
  /** Total sections with valid polyline strings */
  validPolylineCount: number;
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
 * Empty tunnel match details for when no polyline points are checked
 */
const EMPTY_TUNNEL_DETAILS: TunnelMatchDetails = {
  matched: false,
  pointsInside: 0,
};

/**
 * Result from polyline analysis including Alps check and sanity stats
 */
interface PolylineAnalysisResult {
  alpsCheck: AlpsTunnelCheckResult;
  sanityStats: PolylineSanityStats;
  /** Whether decoded polyline bounds are plausible (within Earth coordinate ranges) */
  boundsPlausible: boolean;
  /** Diagnostics for polyline input extraction */
  inputDiagnostics: PolylineInputDiagnostics;
  /** Whether lat/lng swap was applied */
  swapApplied: boolean;
}

/**
 * Empty diagnostics for when no polylines are found
 */
const EMPTY_DIAGNOSTICS: PolylineInputDiagnostics = {
  sections: [],
  chosenIdx: null,
  chosenLength: null,
  chosenPrefix: null,
  validPolylineCount: 0,
};

/**
 * Check if decoded points look like swapped lat/lng for European routes
 * Returns true if lat appears to be in longitude range and vice versa
 */
function looksSwappedForEurope(firstPoint: { lat: number; lng: number }): boolean {
  // European routes: lat should be ~40-60, lng should be ~-10 to 20
  // If lat is between -10..10 AND lng is between 30..70, likely swapped
  return (
    firstPoint.lat >= -10 && firstPoint.lat <= 10 &&
    firstPoint.lng >= 30 && firstPoint.lng <= 70
  );
}

/**
 * Check if bounds look plausible for European routes after potential swap
 */
function boundsPlausibleForEurope(bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }): boolean {
  // European routes: lat 30-70, lng -20 to 40
  return (
    bounds.minLat >= 30 && bounds.maxLat <= 70 &&
    bounds.minLng >= -20 && bounds.maxLng <= 40
  );
}

/**
 * Check all section polylines for Alps tunnel bbox matches
 * Aggregates all polyline points and checks them together for accurate details
 * Also computes sanity stats for debugging
 */
function analyzePolylines(response: HereRoutingResponse): PolylineAnalysisResult {
  const emptyResult: PolylineAnalysisResult = {
    alpsCheck: {
      frejus: false,
      montBlanc: false,
      pointsChecked: 0,
      details: {
        frejus: { ...EMPTY_TUNNEL_DETAILS, matchReason: 'none' },
        montBlanc: { ...EMPTY_TUNNEL_DETAILS, matchReason: 'none' },
      },
    },
    sanityStats: {
      polylineBounds: null,
      polylineFirstPoint: null,
      polylineLastPoint: null,
      pointCount: 0,
    },
    boundsPlausible: false,
    inputDiagnostics: EMPTY_DIAGNOSTICS,
    swapApplied: false,
  };

  if (!response.routes || response.routes.length === 0) {
    return emptyResult;
  }

  // Collect diagnostics about each section's polyline field
  const sectionDiagnostics: PolylineInputDiagnostics['sections'] = [];
  const validPolylines: Array<{ idx: number; polyline: string }> = [];

  for (const route of response.routes) {
    if (!route.sections) continue;

    for (let idx = 0; idx < route.sections.length; idx++) {
      const section = route.sections[idx];
      const p = section.polyline;
      const pType = typeof p;

      let length: number | null = null;
      let prefix: string | null = null;

      if (pType === 'string' && p) {
        length = p.length;
        prefix = p.slice(0, 60);
        if (p.length > 0) {
          validPolylines.push({ idx, polyline: p });
        }
      } else if (p !== undefined && p !== null) {
        // Non-string polyline - capture what it is for debugging
        prefix = JSON.stringify(p).slice(0, 60);
      }

      sectionDiagnostics.push({
        idx,
        type: pType,
        length,
        prefix,
      });
    }
  }

  const inputDiagnostics: PolylineInputDiagnostics = {
    sections: sectionDiagnostics,
    chosenIdx: null,
    chosenLength: null,
    chosenPrefix: null,
    validPolylineCount: validPolylines.length,
  };

  if (validPolylines.length === 0) {
    return { ...emptyResult, inputDiagnostics };
  }

  // Decode ALL valid polyline strings and concatenate points
  const allPoints: Array<{ lat: number; lng: number }> = [];
  let longestIdx = 0;
  let longestLength = 0;

  for (const { idx, polyline } of validPolylines) {
    try {
      const points = decodeFlexiblePolyline(polyline);
      allPoints.push(...points);

      // Track the longest for diagnostics
      if (polyline.length > longestLength) {
        longestLength = polyline.length;
        longestIdx = idx;
      }
    } catch {
      // Ignore polyline decode errors, continue with other sections
    }
  }

  // Update diagnostics with chosen info (longest polyline)
  const longestPolyline = validPolylines.find(v => v.idx === longestIdx);
  if (longestPolyline) {
    inputDiagnostics.chosenIdx = longestIdx;
    inputDiagnostics.chosenLength = longestPolyline.polyline.length;
    inputDiagnostics.chosenPrefix = longestPolyline.polyline.slice(0, 60);
  }

  if (allPoints.length === 0) {
    return { ...emptyResult, inputDiagnostics };
  }

  // Check if lat/lng might be swapped for European routes
  let swapApplied = false;
  const firstPoint = allPoints[0];

  if (looksSwappedForEurope(firstPoint)) {
    // Try swapping all points
    const swappedPoints = allPoints.map(p => ({ lat: p.lng, lng: p.lat }));

    // Compute bounds of swapped points
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    for (const p of swappedPoints) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }

    // If swapped bounds look plausible for Europe, apply the swap
    if (boundsPlausibleForEurope({ minLat, maxLat, minLng, maxLng })) {
      // Apply swap to all points
      for (let i = 0; i < allPoints.length; i++) {
        const tmp = allPoints[i].lat;
        allPoints[i].lat = allPoints[i].lng;
        allPoints[i].lng = tmp;
      }
      swapApplied = true;
    }
  }

  // Compute sanity stats and check bounds plausibility
  const sanityStats = computePolylineSanityStats(allPoints);
  const boundsPlausible = sanityStats.polylineBounds
    ? arePolylineBoundsPlausible(sanityStats.polylineBounds)
    : false;

  // Only run Alps check if bounds are plausible
  // If bounds are implausible, polyline is corrupted and geofencing will be wrong
  let alpsCheck: AlpsTunnelCheckResult;
  if (boundsPlausible) {
    alpsCheck = checkAlpsTunnels(allPoints);
  } else {
    // Return empty result for Alps check - will rely on waypoint proximity instead
    alpsCheck = {
      frejus: false,
      montBlanc: false,
      pointsChecked: allPoints.length,
      details: {
        frejus: { ...EMPTY_TUNNEL_DETAILS, matchReason: 'none' },
        montBlanc: { ...EMPTY_TUNNEL_DETAILS, matchReason: 'none' },
      },
    };
  }

  return {
    alpsCheck,
    sanityStats,
    boundsPlausible,
    inputDiagnostics,
    swapApplied,
  };
}

/**
 * Safely extract string from various HERE action field formats
 * Handles: string, { text: string }, array of strings, etc.
 */
function extractStringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (value && typeof value === 'object') {
    // Handle { text: string } format
    const objValue = value as Record<string, unknown>;
    if (typeof objValue.text === 'string' && objValue.text.trim()) {
      return objValue.text.trim();
    }
    // Handle { value: string } format
    if (typeof objValue.value === 'string' && objValue.value.trim()) {
      return objValue.value.trim();
    }
    // Handle { name: string } format
    if (typeof objValue.name === 'string' && objValue.name.trim()) {
      return objValue.name.trim();
    }
  }
  return null;
}

/**
 * Extract array of strings from various HERE field formats
 * Handles: string[], { name: string[] }, etc.
 */
function extractStringArray(value: unknown): string[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    const results: string[] = [];
    for (const item of value) {
      const str = extractStringValue(item);
      if (str) results.push(str);
    }
    return results;
  }

  if (typeof value === 'object') {
    const objValue = value as Record<string, unknown>;
    // Handle { name: string[] } format
    if (Array.isArray(objValue.name)) {
      return extractStringArray(objValue.name);
    }
    // Handle single string in object
    const str = extractStringValue(value);
    if (str) return [str];
  }

  const str = extractStringValue(value);
  return str ? [str] : [];
}

/**
 * Collect sample strings from HERE response for debugging
 * Returns up to 30 strings from actions, checking various field paths
 */
function collectSamples(response: HereRoutingResponse): string[] {
  const samples: string[] = [];
  const MAX_SAMPLE = 30;

  if (!response.routes || response.routes.length === 0) {
    return samples;
  }

  for (const route of response.routes) {
    if (!route.sections) continue;

    for (const section of route.sections) {
      if (!section.actions) continue;

      for (const action of section.actions) {
        if (samples.length >= MAX_SAMPLE) break;

        // Cast to Record to access potentially undocumented fields
        const actionAny = action as unknown as Record<string, unknown>;

        // Try various instruction field paths
        const instructionStr = extractStringValue(actionAny.instruction);
        if (instructionStr) {
          samples.push(`action:instruction:${instructionStr}`);
        }

        // Try action.text field
        const textStr = extractStringValue(actionAny.text);
        if (textStr && samples.length < MAX_SAMPLE) {
          samples.push(`action:text:${textStr}`);
        }

        // Try action.roadName field
        const roadNameStr = extractStringValue(actionAny.roadName);
        if (roadNameStr && samples.length < MAX_SAMPLE) {
          samples.push(`action:roadName:${roadNameStr}`);
        }

        // Try action.street field
        const streetStr = extractStringValue(actionAny.street);
        if (streetStr && samples.length < MAX_SAMPLE) {
          samples.push(`action:street:${streetStr}`);
        }

        // Try action.name field
        const nameStr = extractStringValue(actionAny.name);
        if (nameStr && samples.length < MAX_SAMPLE) {
          samples.push(`action:name:${nameStr}`);
        }

        // Try currentRoad field (various formats)
        const currentRoadStrs = extractStringArray(actionAny.currentRoad);
        for (const str of currentRoadStrs) {
          if (samples.length >= MAX_SAMPLE) break;
          samples.push(`action:currentRoad:${str}`);
        }

        // Try nextRoad field (various formats)
        const nextRoadStrs = extractStringArray(actionAny.nextRoad);
        for (const str of nextRoadStrs) {
          if (samples.length >= MAX_SAMPLE) break;
          samples.push(`action:nextRoad:${str}`);
        }
      }

      if (samples.length >= MAX_SAMPLE) break;
    }

    if (samples.length >= MAX_SAMPLE) break;
  }

  return samples;
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
    const polylineAnalysis = analyzePolylines(response);
    const samples = collectSamples(response);

    // Compute distances from origin/waypoints/destination to tunnel centers
    const alpsCenterDistances = computeAlpsCenterDistances(
      origin,
      waypoints,
      destination
    );

    // Check waypoint proximity as fallback/primary detection method
    const waypointProximity = checkWaypointProximity(origin, waypoints, destination);

    // Determine final match: use polyline if bounds plausible, otherwise waypoint proximity
    // Waypoint proximity is a deterministic signal for tunnel intent
    let finalFrejusMatch: boolean;
    let finalMontBlancMatch: boolean;
    let frejusMatchReason: AlpsMatchReason;
    let montBlancMatchReason: AlpsMatchReason;
    let finalAlpsMatchDetails: {
      frejus: TunnelMatchDetails;
      montBlanc: TunnelMatchDetails;
    };

    if (polylineAnalysis.boundsPlausible) {
      // Polyline bounds are plausible, use polyline-based detection
      finalFrejusMatch = polylineAnalysis.alpsCheck.frejus;
      finalMontBlancMatch = polylineAnalysis.alpsCheck.montBlanc;
      frejusMatchReason = polylineAnalysis.alpsCheck.details.frejus.matchReason || 'none';
      montBlancMatchReason = polylineAnalysis.alpsCheck.details.montBlanc.matchReason || 'none';
      finalAlpsMatchDetails = polylineAnalysis.alpsCheck.details;
    } else {
      // Polyline bounds are implausible, rely on waypoint proximity
      finalFrejusMatch = waypointProximity.frejus;
      finalMontBlancMatch = waypointProximity.montBlanc;
      frejusMatchReason = waypointProximity.reasons.frejus;
      montBlancMatchReason = waypointProximity.reasons.montBlanc;
      // Build alpsMatchDetails from waypoint proximity result
      finalAlpsMatchDetails = {
        frejus: {
          matched: waypointProximity.frejus,
          pointsInside: 0,
          matchReason: waypointProximity.reasons.frejus,
        },
        montBlanc: {
          matched: waypointProximity.montBlanc,
          pointsInside: 0,
          matchReason: waypointProximity.reasons.montBlanc,
        },
      };
    }

    return {
      hereResponse: response,
      debug: {
        maskedUrl,
        via: waypoints,
        viaCount: waypoints.length,
        sectionsCount: telemetry.sectionsCount,
        actionsCountTotal: telemetry.actionsCountTotal,
        polylinePointsChecked: polylineAnalysis.alpsCheck.pointsChecked,
        alpsMatch: {
          frejus: finalFrejusMatch,
          montBlanc: finalMontBlancMatch,
        },
        alpsMatchDetails: finalAlpsMatchDetails,
        alpsConfig: getAlpsDebugConfig(),
        alpsCenterDistances,
        samples,
        polylineSanity: polylineAnalysis.sanityStats,
        waypointProximity,
        polylineBoundsPlausible: polylineAnalysis.boundsPlausible,
        alpsMatchReason: {
          frejus: frejusMatchReason,
          montBlanc: montBlancMatchReason,
        },
        polylineInputDiagnostics: polylineAnalysis.inputDiagnostics,
        polylineSwapApplied: polylineAnalysis.swapApplied,
      },
    };
  }

  return { routeTruck };
}

export type TruckRouter = ReturnType<typeof createTruckRouter>;
