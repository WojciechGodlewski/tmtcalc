/**
 * Pure state logic for click-to-plan route points.
 *
 * Semantics: the FIRST point is the origin, the LAST point is the
 * destination, everything in between is a via waypoint. Each new click
 * appends at the end, so the latest click always becomes the destination
 * and the previous destination rolls back into a via point.
 *
 * Kept free of React/HERE so it is unit-testable without a map.
 */

export interface RoutePoint {
  lat: number;
  lng: number;
}

/** Sane cap - HERE accepts more vias, but quoting rarely needs them */
export const MAX_ROUTE_POINTS = 10;

/** Minimum points needed to calculate a route (origin + destination) */
export const MIN_ROUTE_POINTS = 2;

function round5(value: number): number {
  return Math.round(value * 100000) / 100000;
}

export function canAddPoint(points: RoutePoint[]): boolean {
  return points.length < MAX_ROUTE_POINTS;
}

/** Append a clicked point (rounded to 5 decimals). No-op when at the cap. */
export function addPoint(points: RoutePoint[], point: RoutePoint): RoutePoint[] {
  if (!canAddPoint(points)) return points;
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return points;
  return [...points, { lat: round5(point.lat), lng: round5(point.lng) }];
}

export function removePoint(points: RoutePoint[], index: number): RoutePoint[] {
  if (index < 0 || index >= points.length) return points;
  return points.filter((_, i) => i !== index);
}

export function undoLastPoint(points: RoutePoint[]): RoutePoint[] {
  return points.slice(0, -1);
}

export function clearPoints(): RoutePoint[] {
  return [];
}

/** Role of a point at the given index: origin (A), destination (B), or via number */
export function pointRole(points: RoutePoint[], index: number): string {
  if (index === 0) return 'A';
  if (index === points.length - 1) return 'B';
  return String(index);
}

export interface PayloadLocations {
  origin: RoutePoint;
  destination: RoutePoint;
  via: RoutePoint[];
}

/**
 * Derive the /api/quote location payload: first point is origin, last is
 * destination, middle points are via. Returns null below the minimum.
 */
export function derivePayloadLocations(points: RoutePoint[]): PayloadLocations | null {
  if (points.length < MIN_ROUTE_POINTS) return null;
  return {
    origin: points[0],
    destination: points[points.length - 1],
    via: points.slice(1, -1),
  };
}
