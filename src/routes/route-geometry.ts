/**
 * Optional route geometry for the /api/quote response (map display).
 *
 * Points come from the corrected, spec-compliant flexible-polyline decoding
 * done in route-truck.ts (all sections concatenated, swap/patch fixes applied).
 *
 * Simplification: uniform stride downsampling. When the decoded route has more
 * than MAX_GEOMETRY_POINTS points, every Nth point is kept (N chosen so the
 * result stays under the cap) and the first and last points are always
 * preserved. This keeps enough shape for display while bounding payload size;
 * `simplified` tells the client that downsampling happened.
 */

export interface RouteGeometryPoint {
  lat: number;
  lng: number;
}

export interface RouteGeometryBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface RouteGeometry {
  points: RouteGeometryPoint[];
  bounds: RouteGeometryBounds;
  pointCount: number;
  simplified: boolean;
}

/** Maximum number of points returned to the client */
export const MAX_GEOMETRY_POINTS = 1000;

/** Round to 5 decimals (~1m precision) to keep the payload compact */
function round5(value: number): number {
  return Math.round(value * 100000) / 100000;
}

/**
 * Build route geometry from corrected decoded polyline points.
 * Returns null when there are not enough points for a meaningful line.
 */
export function buildRouteGeometry(
  points: Array<{ lat: number; lng: number }> | undefined
): RouteGeometry | null {
  if (!points || points.length < 2) {
    return null;
  }

  // Bounds are computed over the FULL point set (before downsampling)
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  let selected = points;
  let simplified = false;

  if (points.length > MAX_GEOMETRY_POINTS) {
    const stride = Math.ceil((points.length - 1) / (MAX_GEOMETRY_POINTS - 1));
    selected = [];
    for (let i = 0; i < points.length; i += stride) {
      selected.push(points[i]);
    }
    // Always preserve the exact last point
    if (selected[selected.length - 1] !== points[points.length - 1]) {
      selected.push(points[points.length - 1]);
    }
    simplified = true;
  }

  const outPoints = selected.map((p) => ({ lat: round5(p.lat), lng: round5(p.lng) }));

  return {
    points: outPoints,
    bounds: {
      minLat: round5(minLat),
      maxLat: round5(maxLat),
      minLng: round5(minLng),
      maxLng: round5(maxLng),
    },
    pointCount: outPoints.length,
    simplified,
  };
}
