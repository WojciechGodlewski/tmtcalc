/**
 * HERE Geocoding & Search API integration
 * https://developer.here.com/documentation/geocoding-search-api/dev_guide/index.html
 */

import { createCache, type Cache } from './cache.js';
import { type HereClient } from './http-client.js';

const GEOCODE_API_URL = 'https://geocode.search.hereapi.com/v1/geocode';

// 7 days TTL in milliseconds
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface GeocodeResult {
  lat: number;
  lng: number;
  label: string;
  countryCode: string | null;
  confidence: number | null;
}

export interface GeocodeOptions {
  /** ISO 3166-1 alpha-3 country code to bias results */
  countryCodeBias?: string;
}

interface HereGeocodeResponse {
  items: Array<{
    title: string;
    id: string;
    resultType: string;
    address: {
      label: string;
      countryCode?: string;
      countryName?: string;
      stateCode?: string;
      state?: string;
      county?: string;
      city?: string;
      district?: string;
      street?: string;
      postalCode?: string;
      houseNumber?: string;
    };
    position: {
      lat: number;
      lng: number;
    };
    scoring?: {
      queryScore?: number;
      fieldScore?: {
        country?: number;
        city?: number;
        streets?: number[];
        houseNumber?: number;
        postalCode?: number;
      };
    };
  }>;
}

/**
 * Create geocoding function with cache
 */
export function createGeocoder(client: HereClient) {
  // Initialize cache with 7-day TTL
  const cache: Cache<GeocodeResult> = createCache<GeocodeResult>({
    ttlMs: CACHE_TTL_MS,
    maxSize: 10000,
  });

  /**
   * Build cache key from query and options
   */
  function buildCacheKey(query: string, options?: GeocodeOptions): string {
    const parts = [query];
    if (options?.countryCodeBias) {
      parts.push(`country:${options.countryCodeBias}`);
    }
    return parts.join('|');
  }

  /**
   * Geocode an address to coordinates
   * @param query Address or place name to geocode
   * @param options Optional geocoding parameters
   * @returns Geocode result with coordinates and metadata
   * @throws HereApiError on API errors
   */
  async function geocode(query: string, options?: GeocodeOptions): Promise<GeocodeResult> {
    if (!query || !query.trim()) {
      throw new Error('Geocode query cannot be empty');
    }

    const cacheKey = buildCacheKey(query, options);

    // Check cache first
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Build request params
    const params: Record<string, string | undefined> = {
      q: query.trim(),
      limit: '1',
      lang: 'en',
    };

    if (options?.countryCodeBias) {
      // HERE uses ISO 3166-1 alpha-3 for 'in' parameter
      params.in = `countryCode:${options.countryCodeBias}`;
    }

    // Make API request
    const response = await client.request<HereGeocodeResponse>(GEOCODE_API_URL, { params });

    if (!response.items || response.items.length === 0) {
      throw new Error(`No geocoding results found for: ${query}`);
    }

    const item = response.items[0];

    // Calculate confidence from scoring
    let confidence: number | null = null;
    if (item.scoring?.queryScore !== undefined) {
      confidence = item.scoring.queryScore;
    }

    const result: GeocodeResult = {
      lat: item.position.lat,
      lng: item.position.lng,
      label: item.address.label,
      countryCode: item.address.countryCode ?? null,
      confidence,
    };

    // Cache the result
    cache.set(cacheKey, result);

    return result;
  }

  /**
   * Clear the geocoding cache
   */
  function clearCache(): void {
    cache.clear();
  }

  /**
   * Get current cache size
   */
  function getCacheSize(): number {
    return cache.size();
  }

  return { geocode, clearCache, getCacheSize };
}

export type Geocoder = ReturnType<typeof createGeocoder>;
