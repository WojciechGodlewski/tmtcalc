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

export interface RouteTruckResult {
  hereResponse: HereRoutingResponse;
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
 * Create truck routing function
 */
export function createTruckRouter(client: HereClient) {
  /**
   * Calculate truck route between origin and destination
   * @param params Route parameters including vehicle profile
   * @returns HERE routing response with route details
   * @throws HereApiError on API errors
   */
  async function routeTruck(params: RouteTruckParams): Promise<RouteTruckResult> {
    const { origin, destination, waypoints = [], vehicleProfileId } = params;

    // Get vehicle profile
    const profile = getVehicleProfile(vehicleProfileId);

    // Build via parameter for waypoints
    const viaPoints = waypoints.map(formatCoords);

    // Build request params
    const requestParams: Record<string, string | number | boolean | undefined> = {
      transportMode: 'truck',
      origin: formatCoords(origin),
      destination: formatCoords(destination),
      return: 'summary,tolls,actions,notices',
      // Vehicle dimensions and weight
      'truck[grossWeight]': profile.grossWeight,
      'truck[height]': Math.round(profile.height * 100), // Convert to cm
      'truck[width]': Math.round(profile.width * 100), // Convert to cm
      'truck[length]': Math.round(profile.length * 100), // Convert to cm
      'truck[axleCount]': profile.axleCount,
    };

    // Add waypoints if present
    if (viaPoints.length > 0) {
      viaPoints.forEach((via, index) => {
        requestParams[`via${index}`] = via;
      });
    }

    // Make API request
    const response = await client.request<HereRoutingResponse>(ROUTING_API_URL, {
      params: requestParams,
    });

    return { hereResponse: response };
  }

  return { routeTruck };
}

export type TruckRouter = ReturnType<typeof createTruckRouter>;
