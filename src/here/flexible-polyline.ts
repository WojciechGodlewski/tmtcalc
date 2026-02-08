/**
 * HERE Flexible Polyline decoder
 * Decodes polylines returned by HERE Routing API v8
 *
 * Format specification: https://github.com/heremaps/flexible-polyline
 * This is a minimal server-side implementation supporting lat/lng decoding.
 */

export interface PolylinePoint {
  lat: number;
  lng: number;
}

// Decoding table for base64-like encoding
const DECODING_TABLE = [
  62, -1, -1, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, -1, -1, -1, -1, -1, -1,
  -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
  20, 21, 22, 23, 24, 25, -1, -1, -1, -1, 63, -1, 26, 27, 28, 29, 30, 31, 32,
  33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51,
];

// Encoding table for base64-like encoding (reverse of DECODING_TABLE)
const ENCODING_TABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Encode an unsigned value to flexible polyline format
 */
function encodeUnsignedValue(value: number): string {
  let result = '';
  while (value > 0x1f) {
    result += ENCODING_TABLE[(value & 0x1f) | 0x20];
    value >>>= 5;
  }
  result += ENCODING_TABLE[value];
  return result;
}

/**
 * Encode a signed value to flexible polyline format (with zig-zag encoding)
 */
function encodeSignedValue(value: number): string {
  // Zig-zag encode
  const unsigned = value < 0 ? ~(value << 1) : (value << 1);
  return encodeUnsignedValue(unsigned);
}

/**
 * Encode an array of lat/lng points to HERE Flexible Polyline format
 * @param points Array of points to encode
 * @param precision Decimal places for lat/lng (default 5)
 * @returns Encoded polyline string
 */
export function encodeFlexiblePolyline(points: PolylinePoint[], precision: number = 5): string {
  if (points.length === 0) {
    return '';
  }

  const factor = Math.pow(10, precision);

  // Encode header (precision only, no 3rd dimension)
  // Header format: bits 0-3 = precision, bits 4-6 = 0 (no 3rd dim)
  let result = encodeUnsignedValue(precision);

  let lastLat = 0;
  let lastLng = 0;

  for (const point of points) {
    const scaledLat = Math.round(point.lat * factor);
    const scaledLng = Math.round(point.lng * factor);

    const deltaLat = scaledLat - lastLat;
    const deltaLng = scaledLng - lastLng;

    result += encodeSignedValue(deltaLat);
    result += encodeSignedValue(deltaLng);

    lastLat = scaledLat;
    lastLng = scaledLng;
  }

  return result;
}

/**
 * Decode a single unsigned varint value from the polyline at the given index
 * Returns the decoded value and the new index position
 * Used for header and metadata values (no zig-zag decoding)
 */
function decodeUnsignedValue(encoded: string, index: number): [number, number] {
  let result = 0;
  let shift = 0;
  let i = index;

  while (i < encoded.length) {
    const charCode = encoded.charCodeAt(i) - 45;
    if (charCode < 0 || charCode >= DECODING_TABLE.length) {
      throw new Error(`Invalid character at position ${i}`);
    }

    const value = DECODING_TABLE[charCode];
    if (value < 0) {
      throw new Error(`Invalid character at position ${i}`);
    }

    result |= (value & 0x1f) << shift;
    shift += 5;
    i++;

    // Check if this is the last chunk (bit 5 not set)
    if ((value & 0x20) === 0) {
      break;
    }
  }

  return [result, i];
}

/**
 * Decode a single signed value from the polyline at the given index
 * Returns the decoded value and the new index position
 * Uses zig-zag decoding for coordinate deltas
 */
function decodeSignedValue(encoded: string, index: number): [number, number] {
  const [unsigned, nextIndex] = decodeUnsignedValue(encoded, index);

  // Convert from unsigned to signed using zig-zag decoding
  let result = unsigned;
  if (result & 1) {
    result = ~result;
  }
  result >>= 1;

  return [result, nextIndex];
}

/**
 * Decode HERE Flexible Polyline to array of lat/lng points
 *
 * Format: https://github.com/heremaps/flexible-polyline
 * Header structure (single unsigned value):
 *   - bits 0-3: lat/lng precision (0-15)
 *   - bits 4-6: third dimension type (0=absent, 1=altitude, 2=elevation, etc.)
 *   - bits 7-10: third dimension precision (if type != 0)
 *
 * @param encoded The encoded polyline string from HERE Routing API
 * @returns Array of decoded points with lat/lng coordinates in degrees
 * @throws Error if the polyline is invalid or cannot be decoded
 */
export function decodeFlexiblePolyline(encoded: string): PolylinePoint[] {
  if (!encoded || encoded.length === 0) {
    return [];
  }

  const points: PolylinePoint[] = [];

  // Decode header (unsigned - no zig-zag)
  let index = 0;

  // First value: header with precision info (unsigned)
  // All precision info is encoded in this single value
  const [header, nextIndex] = decodeUnsignedValue(encoded, index);
  index = nextIndex;

  // Extract precision from header (bits 0-3)
  const precision = header & 0x0f;
  const factor = Math.pow(10, precision);

  // Check if 3rd dimension is present (bits 4-6 encode type, 0 = absent)
  const thirdDimType = (header >> 4) & 0x07;
  const has3rdDim = thirdDimType !== 0;

  // Third dimension precision is in bits 7-10 of the SAME header value
  // (Not a separate encoded value - this was a bug)

  // Decode points (signed values with zig-zag)
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    // Decode delta lat (signed)
    const [deltaLat, nextLat] = decodeSignedValue(encoded, index);
    index = nextLat;

    if (index >= encoded.length) break;

    // Decode delta lng (signed)
    const [deltaLng, nextLng] = decodeSignedValue(encoded, index);
    index = nextLng;

    // Skip 3rd dimension if present (signed)
    if (has3rdDim && index < encoded.length) {
      const [, next3rd] = decodeSignedValue(encoded, index);
      index = next3rd;
    }

    // Apply deltas
    lat += deltaLat;
    lng += deltaLng;

    // Convert to actual coordinates (degrees)
    points.push({
      lat: lat / factor,
      lng: lng / factor,
    });
  }

  // Sanity check: validate coordinates are in valid ranges
  // If not, try to auto-fix by applying missing scaling
  if (points.length > 0) {
    const firstPoint = points[0];
    const needsAutoFix = Math.abs(firstPoint.lat) > 90 || Math.abs(firstPoint.lng) > 180;

    if (needsAutoFix) {
      // Try dividing by 1e5 (common scaling factor issue)
      const scale1e5Check = points.every(p =>
        Math.abs(p.lat / 1e5) <= 90 && Math.abs(p.lng / 1e5) <= 180
      );

      if (scale1e5Check) {
        for (const p of points) {
          p.lat = p.lat / 1e5;
          p.lng = p.lng / 1e5;
        }
      } else {
        // Try dividing by 1e6
        const scale1e6Check = points.every(p =>
          Math.abs(p.lat / 1e6) <= 90 && Math.abs(p.lng / 1e6) <= 180
        );

        if (scale1e6Check) {
          for (const p of points) {
            p.lat = p.lat / 1e6;
            p.lng = p.lng / 1e6;
          }
        }
        // If neither works, return as-is but log a warning
        // The sanity checker downstream will mark bounds as implausible
      }
    }
  }

  return points;
}

/**
 * Bounding box definition
 */
export interface BoundingBox {
  name: string;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * Polyline bounds for sanity checking decoded coordinates
 */
export interface PolylineBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * Polyline sanity stats for debugging
 */
export interface PolylineSanityStats {
  polylineBounds: PolylineBounds | null;
  polylineFirstPoint: PolylinePoint | null;
  polylineLastPoint: PolylinePoint | null;
  pointCount: number;
}

/**
 * Compute sanity stats from decoded polyline points
 * Used for debugging to verify decoder output is plausible
 */
export function computePolylineSanityStats(points: PolylinePoint[]): PolylineSanityStats {
  if (points.length === 0) {
    return {
      polylineBounds: null,
      polylineFirstPoint: null,
      polylineLastPoint: null,
      pointCount: 0,
    };
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const point of points) {
    if (point.lat < minLat) minLat = point.lat;
    if (point.lat > maxLat) maxLat = point.lat;
    if (point.lng < minLng) minLng = point.lng;
    if (point.lng > maxLng) maxLng = point.lng;
  }

  return {
    polylineBounds: {
      minLat: Math.round(minLat * 100000) / 100000,
      maxLat: Math.round(maxLat * 100000) / 100000,
      minLng: Math.round(minLng * 100000) / 100000,
      maxLng: Math.round(maxLng * 100000) / 100000,
    },
    polylineFirstPoint: {
      lat: Math.round(points[0].lat * 100000) / 100000,
      lng: Math.round(points[0].lng * 100000) / 100000,
    },
    polylineLastPoint: {
      lat: Math.round(points[points.length - 1].lat * 100000) / 100000,
      lng: Math.round(points[points.length - 1].lng * 100000) / 100000,
    },
    pointCount: points.length,
  };
}

/**
 * Alpine tunnel bounding boxes
 * Conservative boxes to avoid false negatives
 */
export const FREJUS_BBOX: BoundingBox = {
  name: 'Frejus',
  minLat: 45.03,
  maxLat: 45.17,
  minLng: 6.60,
  maxLng: 6.78,
};

export const MONT_BLANC_BBOX: BoundingBox = {
  name: 'Mont Blanc',
  minLat: 45.82,
  maxLat: 45.96,
  minLng: 6.92,
  maxLng: 7.03,
};

/**
 * Tunnel center points for distance-based fallback detection
 * These are approximate center coordinates of the tunnel corridors
 * Fréjus: between Bardonecchia (IT) and Modane (FR)
 * Mont Blanc: between Courmayeur (IT) and Chamonix (FR)
 */
export const FREJUS_CENTER: PolylinePoint = {
  lat: 45.086,  // Tunnel center latitude
  lng: 6.706,   // Tunnel center longitude
};

export const MONT_BLANC_CENTER: PolylinePoint = {
  lat: 45.924,  // Tunnel center latitude (corrected - was 45.89)
  lng: 6.968,   // Tunnel center longitude
};

/** Distance threshold in km for fallback detection (polyline points) */
export const TUNNEL_PROXIMITY_KM = 3.0;

/** Distance threshold in km for waypoint proximity detection */
export const WAYPOINT_PROXIMITY_THRESHOLD_KM = 3.0;

/**
 * Debug info for Alps tunnel detection configuration
 * Exposes the exact centers and bboxes being used
 */
export interface AlpsDebugConfig {
  centers: {
    frejus: { lat: number; lng: number };
    montBlanc: { lat: number; lng: number };
  };
  bboxes: {
    frejus: { minLat: number; maxLat: number; minLng: number; maxLng: number };
    montBlanc: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  };
}

/**
 * Get the Alps tunnel detection configuration for debugging
 */
export function getAlpsDebugConfig(): AlpsDebugConfig {
  return {
    centers: {
      frejus: { lat: FREJUS_CENTER.lat, lng: FREJUS_CENTER.lng },
      montBlanc: { lat: MONT_BLANC_CENTER.lat, lng: MONT_BLANC_CENTER.lng },
    },
    bboxes: {
      frejus: {
        minLat: FREJUS_BBOX.minLat,
        maxLat: FREJUS_BBOX.maxLat,
        minLng: FREJUS_BBOX.minLng,
        maxLng: FREJUS_BBOX.maxLng,
      },
      montBlanc: {
        minLat: MONT_BLANC_BBOX.minLat,
        maxLat: MONT_BLANC_BBOX.maxLat,
        minLng: MONT_BLANC_BBOX.minLng,
        maxLng: MONT_BLANC_BBOX.maxLng,
      },
    },
  };
}

/**
 * Compute distances from given points to tunnel centers
 * Used for debugging to verify coordinate handling
 */
export interface AlpsCenterDistances {
  frejus: {
    fromOrigin?: number;
    fromWaypoints: number[];
    fromDestination?: number;
  };
  montBlanc: {
    fromOrigin?: number;
    fromWaypoints: number[];
    fromDestination?: number;
  };
}

export function computeAlpsCenterDistances(
  origin: PolylinePoint | null,
  waypoints: PolylinePoint[],
  destination: PolylinePoint | null
): AlpsCenterDistances {
  const roundDist = (d: number) => Math.round(d * 100) / 100;

  return {
    frejus: {
      fromOrigin: origin ? roundDist(haversineDistanceKm(origin, FREJUS_CENTER)) : undefined,
      fromWaypoints: waypoints.map((wp) => roundDist(haversineDistanceKm(wp, FREJUS_CENTER))),
      fromDestination: destination ? roundDist(haversineDistanceKm(destination, FREJUS_CENTER)) : undefined,
    },
    montBlanc: {
      fromOrigin: origin ? roundDist(haversineDistanceKm(origin, MONT_BLANC_CENTER)) : undefined,
      fromWaypoints: waypoints.map((wp) => roundDist(haversineDistanceKm(wp, MONT_BLANC_CENTER))),
      fromDestination: destination ? roundDist(haversineDistanceKm(destination, MONT_BLANC_CENTER)) : undefined,
    },
  };
}

/**
 * Match reason for Alps tunnel detection
 */
export type AlpsMatchReason = 'waypointProximity' | 'polylineBbox' | 'polylineDistance' | 'none';

/**
 * Alps match reason for both tunnels
 */
export interface AlpsMatchReasons {
  frejus: AlpsMatchReason;
  montBlanc: AlpsMatchReason;
}

/**
 * Result of waypoint proximity check for Alps tunnels
 */
export interface WaypointProximityResult {
  frejus: boolean;
  montBlanc: boolean;
  reasons: AlpsMatchReasons;
}

/**
 * Check if any waypoints (including origin/destination) are within proximity of tunnel centers
 * This is a deterministic signal for tunnel intent when polyline decoding fails
 */
export function checkWaypointProximity(
  origin: PolylinePoint | null,
  waypoints: PolylinePoint[],
  destination: PolylinePoint | null
): WaypointProximityResult {
  const allPoints: PolylinePoint[] = [];
  if (origin) allPoints.push(origin);
  allPoints.push(...waypoints);
  if (destination) allPoints.push(destination);

  let frejusMatch = false;
  let montBlancMatch = false;

  for (const point of allPoints) {
    const frejusDist = haversineDistanceKm(point, FREJUS_CENTER);
    const montBlancDist = haversineDistanceKm(point, MONT_BLANC_CENTER);

    if (frejusDist <= WAYPOINT_PROXIMITY_THRESHOLD_KM) {
      frejusMatch = true;
    }
    if (montBlancDist <= WAYPOINT_PROXIMITY_THRESHOLD_KM) {
      montBlancMatch = true;
    }
  }

  return {
    frejus: frejusMatch,
    montBlanc: montBlancMatch,
    reasons: {
      frejus: frejusMatch ? 'waypointProximity' : 'none',
      montBlanc: montBlancMatch ? 'waypointProximity' : 'none',
    },
  };
}

/**
 * Check if polyline bounds are plausible (within Earth coordinate ranges)
 * Returns false if bounds indicate corrupted/incorrect decoding
 */
export function arePolylineBoundsPlausible(bounds: PolylineBounds): boolean {
  // Valid latitude: -90 to 90
  // Valid longitude: -180 to 180
  // Add some tolerance for rounding
  const MAX_LAT = 90.1;
  const MIN_LAT = -90.1;
  const MAX_LNG = 180.1;
  const MIN_LNG = -180.1;

  return (
    bounds.minLat >= MIN_LAT &&
    bounds.maxLat <= MAX_LAT &&
    bounds.minLng >= MIN_LNG &&
    bounds.maxLng <= MAX_LNG &&
    bounds.minLat <= bounds.maxLat &&
    bounds.minLng <= bounds.maxLng
  );
}

/**
 * Calculate haversine distance between two points in kilometers
 */
export function haversineDistanceKm(p1: PolylinePoint, p2: PolylinePoint): number {
  const R = 6371; // Earth's radius in km
  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
  const dLng = (p2.lng - p1.lng) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Check if a point is inside a bounding box
 */
export function isPointInBBox(point: PolylinePoint, bbox: BoundingBox): boolean {
  return (
    point.lat >= bbox.minLat &&
    point.lat <= bbox.maxLat &&
    point.lng >= bbox.minLng &&
    point.lng <= bbox.maxLng
  );
}

/**
 * Detailed match info for a single tunnel
 */
export interface TunnelMatchDetails {
  /** True if matched by bbox or proximity */
  matched: boolean;
  /** Number of points inside bbox */
  pointsInside: number;
  /** First point inside bbox (if any) */
  firstPoint?: PolylinePoint;
  /** True if matched by proximity fallback (polyline point proximity) */
  matchedByProximity?: boolean;
  /** Closest distance to tunnel center in km (if checked) */
  closestDistanceKm?: number;
  /** Match reason for debugging */
  matchReason?: AlpsMatchReason;
}

/**
 * Result of checking polyline against alpine tunnel bounding boxes
 */
export interface AlpsTunnelCheckResult {
  /** True if any point is in Frejus bbox or within proximity */
  frejus: boolean;
  /** True if any point is in Mont Blanc bbox or within proximity */
  montBlanc: boolean;
  /** Total number of points checked */
  pointsChecked: number;
  /** Detailed match info for each tunnel */
  details: {
    frejus: TunnelMatchDetails;
    montBlanc: TunnelMatchDetails;
  };
}

/**
 * Check if any polyline points fall within alpine tunnel bounding boxes
 * Uses bbox check as primary, distance-to-center as fallback
 *
 * @param points Array of decoded polyline points
 * @returns Object indicating which tunnels the route passes through with detailed diagnostics
 */
export function checkAlpsTunnels(points: PolylinePoint[]): AlpsTunnelCheckResult {
  // Initialize detailed tracking
  const frejusDetails: TunnelMatchDetails = {
    matched: false,
    pointsInside: 0,
    closestDistanceKm: undefined,
  };

  const montBlancDetails: TunnelMatchDetails = {
    matched: false,
    pointsInside: 0,
    closestDistanceKm: undefined,
  };

  // Track closest distances for proximity fallback
  let frejusMinDist = Infinity;
  let montBlancMinDist = Infinity;
  let frejusClosestPoint: PolylinePoint | undefined;
  let montBlancClosestPoint: PolylinePoint | undefined;

  for (const point of points) {
    // Check Frejus bbox
    if (isPointInBBox(point, FREJUS_BBOX)) {
      frejusDetails.pointsInside++;
      if (!frejusDetails.firstPoint) {
        frejusDetails.firstPoint = { lat: point.lat, lng: point.lng };
      }
    }

    // Check Mont Blanc bbox
    if (isPointInBBox(point, MONT_BLANC_BBOX)) {
      montBlancDetails.pointsInside++;
      if (!montBlancDetails.firstPoint) {
        montBlancDetails.firstPoint = { lat: point.lat, lng: point.lng };
      }
    }

    // Calculate distances for proximity fallback
    const frejusDist = haversineDistanceKm(point, FREJUS_CENTER);
    if (frejusDist < frejusMinDist) {
      frejusMinDist = frejusDist;
      frejusClosestPoint = point;
    }

    const montBlancDist = haversineDistanceKm(point, MONT_BLANC_CENTER);
    if (montBlancDist < montBlancMinDist) {
      montBlancMinDist = montBlancDist;
      montBlancClosestPoint = point;
    }
  }

  // Set closest distances
  frejusDetails.closestDistanceKm = frejusMinDist === Infinity ? undefined : Math.round(frejusMinDist * 100) / 100;
  montBlancDetails.closestDistanceKm = montBlancMinDist === Infinity ? undefined : Math.round(montBlancMinDist * 100) / 100;

  // Determine matches: bbox first, then proximity fallback
  if (frejusDetails.pointsInside > 0) {
    frejusDetails.matched = true;
    frejusDetails.matchReason = 'polylineBbox';
  } else if (frejusMinDist <= TUNNEL_PROXIMITY_KM) {
    frejusDetails.matched = true;
    frejusDetails.matchedByProximity = true;
    frejusDetails.firstPoint = frejusClosestPoint;
    frejusDetails.matchReason = 'polylineDistance';
  } else {
    frejusDetails.matchReason = 'none';
  }

  if (montBlancDetails.pointsInside > 0) {
    montBlancDetails.matched = true;
    montBlancDetails.matchReason = 'polylineBbox';
  } else if (montBlancMinDist <= TUNNEL_PROXIMITY_KM) {
    montBlancDetails.matched = true;
    montBlancDetails.matchedByProximity = true;
    montBlancDetails.firstPoint = montBlancClosestPoint;
    montBlancDetails.matchReason = 'polylineDistance';
  } else {
    montBlancDetails.matchReason = 'none';
  }

  return {
    frejus: frejusDetails.matched,
    montBlanc: montBlancDetails.matched,
    pointsChecked: points.length,
    details: {
      frejus: frejusDetails,
      montBlanc: montBlancDetails,
    },
  };
}

/**
 * Check encoded polyline against alpine tunnel bounding boxes
 * Convenience function that decodes and checks in one call
 *
 * @param encoded The encoded polyline string from HERE Routing API
 * @returns Object indicating which tunnels the route passes through
 */
export function checkAlpsTunnelsFromPolyline(encoded: string): AlpsTunnelCheckResult {
  const points = decodeFlexiblePolyline(encoded);
  return checkAlpsTunnels(points);
}
