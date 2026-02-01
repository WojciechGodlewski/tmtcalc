/**
 * HERE API client module
 * Provides geocoding and truck routing functionality
 */

import { createHereClient, HereApiError, type HereClientConfig } from './http-client.js';
import { createGeocoder, type GeocodeResult, type GeocodeOptions } from './geocode.js';
import { createTruckRouter, type RouteTruckParams, type RouteTruckResult } from './route-truck.js';
import { VEHICLE_PROFILES, getVehicleProfile, type VehicleProfileId, type VehicleProfile } from './vehicle-profiles.js';

export interface HereServiceConfig {
  apiKey: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface HereService {
  geocode: (query: string, options?: GeocodeOptions) => Promise<GeocodeResult>;
  routeTruck: (params: RouteTruckParams) => Promise<RouteTruckResult>;
  clearGeocodeCache: () => void;
  getGeocodeCacheSize: () => number;
}

/**
 * Creates the HERE API service
 * @throws Error if API key is not provided
 */
export function createHereService(config: HereServiceConfig): HereService {
  const { apiKey, timeoutMs, maxRetries } = config;

  if (!apiKey) {
    throw new Error('HERE_API_KEY is required. Set process.env.HERE_API_KEY or provide apiKey in config.');
  }

  const clientConfig: HereClientConfig = {
    apiKey,
    timeoutMs,
    maxRetries,
  };

  const client = createHereClient(clientConfig);
  const geocoder = createGeocoder(client);
  const truckRouter = createTruckRouter(client);

  return {
    geocode: geocoder.geocode,
    routeTruck: truckRouter.routeTruck,
    clearGeocodeCache: geocoder.clearCache,
    getGeocodeCacheSize: geocoder.getCacheSize,
  };
}

/**
 * Creates HERE service from environment variables
 * @throws Error if HERE_API_KEY environment variable is not set
 */
export function createHereServiceFromEnv(): HereService {
  const apiKey = process.env.HERE_API_KEY;

  if (!apiKey) {
    throw new Error('HERE_API_KEY environment variable is required');
  }

  return createHereService({ apiKey });
}

// Re-export types and utilities
export {
  HereApiError,
  type GeocodeResult,
  type GeocodeOptions,
  type RouteTruckParams,
  type RouteTruckResult,
  type VehicleProfile,
  type VehicleProfileId,
  VEHICLE_PROFILES,
  getVehicleProfile,
};

// Re-export response types for consumers
export type {
  HereRoutingResponse,
  HereRoute,
  HereRouteSection,
  HereRouteSummary,
  HereTollInfo,
  HereRouteAction,
  HereNotice,
} from './route-truck.js';
