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

/**
 * Decode a single signed value from the polyline at the given index
 * Returns the decoded value and the new index position
 */
function decodeValue(encoded: string, index: number): [number, number] {
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

  // Convert from unsigned to signed using zig-zag decoding
  if (result & 1) {
    result = ~result;
  }
  result >>= 1;

  return [result, i];
}

/**
 * Decode HERE Flexible Polyline to array of lat/lng points
 *
 * @param encoded The encoded polyline string from HERE Routing API
 * @returns Array of decoded points with lat/lng coordinates
 * @throws Error if the polyline is invalid or cannot be decoded
 */
export function decodeFlexiblePolyline(encoded: string): PolylinePoint[] {
  if (!encoded || encoded.length === 0) {
    return [];
  }

  const points: PolylinePoint[] = [];

  // Decode header
  let index = 0;

  // First value: header version and precision info
  const [header, nextIndex] = decodeValue(encoded, index);
  index = nextIndex;

  // Extract precision from header (bits 0-3)
  const precision = header & 0x0f;
  const factor = Math.pow(10, precision);

  // Check if 3rd dimension is present (bit 4)
  const has3rdDim = (header & 0x10) !== 0;

  // If 3rd dimension present, decode its precision (next value)
  if (has3rdDim) {
    const [, next] = decodeValue(encoded, index);
    index = next;
  }

  // Decode points
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    // Decode delta lat
    const [deltaLat, nextLat] = decodeValue(encoded, index);
    index = nextLat;

    // Decode delta lng
    const [deltaLng, nextLng] = decodeValue(encoded, index);
    index = nextLng;

    // Skip 3rd dimension if present
    if (has3rdDim && index < encoded.length) {
      const [, next3rd] = decodeValue(encoded, index);
      index = next3rd;
    }

    // Apply deltas
    lat += deltaLat;
    lng += deltaLng;

    // Convert to actual coordinates
    points.push({
      lat: lat / factor,
      lng: lng / factor,
    });
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
 * Result of checking polyline against alpine tunnel bounding boxes
 */
export interface AlpsTunnelCheckResult {
  /** True if any point is in Frejus bbox */
  frejus: boolean;
  /** True if any point is in Mont Blanc bbox */
  montBlanc: boolean;
  /** Total number of points checked */
  pointsChecked: number;
}

/**
 * Check if any polyline points fall within alpine tunnel bounding boxes
 *
 * @param points Array of decoded polyline points
 * @returns Object indicating which tunnels the route passes through
 */
export function checkAlpsTunnels(points: PolylinePoint[]): AlpsTunnelCheckResult {
  let frejus = false;
  let montBlanc = false;

  for (const point of points) {
    if (!frejus && isPointInBBox(point, FREJUS_BBOX)) {
      frejus = true;
    }
    if (!montBlanc && isPointInBBox(point, MONT_BLANC_BBOX)) {
      montBlanc = true;
    }
    // Early exit if both found
    if (frejus && montBlanc) {
      break;
    }
  }

  return {
    frejus,
    montBlanc,
    pointsChecked: points.length,
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
