/**
 * Best-effort reverse geocoding of truck restriction segments, so the UI can
 * show a human-readable "Near: ..." label next to raw coordinates.
 *
 * Rules (see README):
 * - only restriction segments are reverse geocoded (segment midpoint),
 * - at most MAX_LOOKUPS_PER_REQUEST segments per request; the rest get
 *   location=null,
 * - near-identical midpoints (rounded to 4 decimals, ~11 m) are deduplicated
 *   within the request so HERE is called once per distinct point,
 * - failures NEVER fail the quote/route-facts request - the segment simply
 *   keeps location=null and coordinates remain available,
 * - uses the backend HERE_API_KEY via the existing geocoder (which also has
 *   its own 7-day in-memory cache); the frontend never calls HERE geocoding.
 */

import type { ReverseGeocodeResult } from '../here/geocode.js';
import type { RestrictionSegment, SegmentLocation } from '../types/route-facts.js';
import { sanitizeErrorMessage } from '../errors.js';

/** Maximum reverse geocode lookups per request */
export const MAX_LOOKUPS_PER_REQUEST = 5;

export interface RestrictionLocationLookupStats {
  /** Segments for which a location lookup was performed (incl. dedupe reuse) */
  attempted: number;
  /** Segments that received a non-null location */
  succeeded: number;
  /** Segments whose lookup failed or returned nothing usable */
  failed: number;
  /** Segments skipped (over the cap, or no usable coordinates) */
  skipped: number;
}

type ReverseGeocodeFn = (lat: number, lng: number) => Promise<ReverseGeocodeResult>;

function round5(value: number): number {
  return Math.round(value * 100000) / 100000;
}

/** Midpoint of the segment, or the single available endpoint, or null */
function segmentMidpoint(segment: RestrictionSegment): { lat: number; lng: number } | null {
  const { startPoint, endPoint } = segment;
  if (startPoint && endPoint) {
    return {
      lat: round5((startPoint.lat + endPoint.lat) / 2),
      lng: round5((startPoint.lng + endPoint.lng) / 2),
    };
  }
  const only = startPoint ?? endPoint;
  return only ? { lat: round5(only.lat), lng: round5(only.lng) } : null;
}

/** Build the compact location from a reverse geocode result, or null */
function toSegmentLocation(result: ReverseGeocodeResult): SegmentLocation | null {
  // Compose a fallback label from components when HERE's label is empty
  const label =
    result.label ||
    [result.city ?? result.district ?? result.county, result.state, result.countryCode]
      .filter(Boolean)
      .join(', ');

  if (!label) return null;

  return {
    label,
    city: result.city ?? null,
    district: result.district ?? null,
    county: result.county ?? null,
    state: result.state ?? null,
    countryCode: result.countryCode ?? null,
    street: result.street ?? null,
    source: 'here_reverse_geocode',
  };
}

/**
 * Enrich restriction segments in place with midPoint + reverse-geocoded
 * location. Never throws; returns compact lookup stats for debug.
 */
export async function enrichRestrictionSegmentsWithLocations(
  reverseGeocode: ReverseGeocodeFn,
  segments: RestrictionSegment[]
): Promise<RestrictionLocationLookupStats> {
  const stats: RestrictionLocationLookupStats = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };

  // In-request dedupe of near-identical midpoints (4 decimals ~ 11 m)
  const cache = new Map<string, SegmentLocation | null>();
  let lookupsUsed = 0;

  for (const segment of segments) {
    const midPoint = segmentMidpoint(segment);
    segment.midPoint = midPoint;

    if (!midPoint) {
      segment.location = null;
      stats.skipped++;
      continue;
    }

    const key = `${midPoint.lat.toFixed(4)},${midPoint.lng.toFixed(4)}`;

    if (cache.has(key)) {
      // Reuse the result already fetched for a near-identical midpoint
      const cached = cache.get(key) ?? null;
      segment.location = cached;
      stats.attempted++;
      if (cached) stats.succeeded++;
      else stats.failed++;
      continue;
    }

    if (lookupsUsed >= MAX_LOOKUPS_PER_REQUEST) {
      segment.location = null;
      stats.skipped++;
      continue;
    }

    lookupsUsed++;
    stats.attempted++;
    try {
      const result = await reverseGeocode(midPoint.lat, midPoint.lng);
      const location = result ? toSegmentLocation(result) : null;
      cache.set(key, location);
      segment.location = location;
      if (location) stats.succeeded++;
      else stats.failed++;
    } catch (error) {
      // Best effort only - never fail the request over a location label
      const message = error instanceof Error ? error.message : 'unknown error';
      console.warn(
        '[restriction-locations] reverse geocode failed:',
        sanitizeErrorMessage(message)
      );
      cache.set(key, null);
      segment.location = null;
      stats.failed++;
    }
  }

  return stats;
}
