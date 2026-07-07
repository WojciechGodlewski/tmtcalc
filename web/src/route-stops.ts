/**
 * Unified route stop model: ONE ordered list of stops is the single source
 * of truth for the route, whether stops are typed as addresses or clicked
 * on the map. The first filled stop is the origin (A), the last filled stop
 * is the destination (B), everything between is a via waypoint.
 *
 * Map clicks fill the first empty address row if one exists (so the default
 * two-row form behaves naturally), otherwise they append - which makes the
 * latest click the destination and rolls the previous destination into a
 * via. Address and point stops can be mixed freely; the backend accepts
 * either shape per location.
 *
 * Kept free of React/HERE so it is unit-testable without a map.
 */

export type Stop =
  | { kind: 'address'; address: string }
  | { kind: 'point'; lat: number; lng: number };

export interface PlanningMarker {
  lat: number;
  lng: number;
  role: string;
}

/** Minimum filled stops needed to calculate a route (origin + destination) */
export const MIN_STOPS = 2;

/** Sane cap - HERE accepts more vias, but quoting rarely needs them */
export const MAX_STOPS = 10;

function round5(value: number): number {
  return Math.round(value * 100000) / 100000;
}

export function emptyAddressStop(): Stop {
  return { kind: 'address', address: '' };
}

/** Default form state: two empty address rows (origin + destination) */
export function emptyStops(): Stop[] {
  return [emptyAddressStop(), emptyAddressStop()];
}

/** Build address stops for presets */
export function addressStops(addresses: string[]): Stop[] {
  return addresses.map((address) => ({ kind: 'address', address }));
}

export function isEmptyStop(stop: Stop): boolean {
  return stop.kind === 'address' && stop.address.trim() === '';
}

/** Stops that actually contribute to the route (empty address rows ignored) */
export function filledStops(stops: Stop[]): Stop[] {
  return stops.filter((s) => !isEmptyStop(s));
}

/** Whether a map click can still be accepted (empty row to fill, or room to append) */
export function canAcceptPoint(stops: Stop[]): boolean {
  return stops.some(isEmptyStop) || stops.length < MAX_STOPS;
}

/**
 * Add a clicked point: fill the first empty address row when one exists,
 * otherwise append (latest click becomes the destination). No-op at the cap.
 */
export function addPointStop(stops: Stop[], point: { lat: number; lng: number }): Stop[] {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return stops;
  const pointStop: Stop = { kind: 'point', lat: round5(point.lat), lng: round5(point.lng) };

  const emptyIndex = stops.findIndex(isEmptyStop);
  if (emptyIndex >= 0) {
    return stops.map((s, i) => (i === emptyIndex ? pointStop : s));
  }
  if (stops.length >= MAX_STOPS) return stops;
  return [...stops, pointStop];
}

export function updateAddressStop(stops: Stop[], index: number, address: string): Stop[] {
  return stops.map((s, i) => (i === index ? { kind: 'address' as const, address } : s));
}

export function addEmptyStop(stops: Stop[]): Stop[] {
  if (stops.length >= MAX_STOPS) return stops;
  return [...stops, emptyAddressStop()];
}

/** Remove a stop; the list is padded back to two rows so A/B slots remain */
export function removeStop(stops: Stop[], index: number): Stop[] {
  if (index < 0 || index >= stops.length) return stops;
  const next = stops.filter((_, i) => i !== index);
  while (next.length < MIN_STOPS) next.push(emptyAddressStop());
  return next;
}

/** Drop clicked points but keep typed addresses (used by "Clear quote") */
export function clearPointStops(stops: Stop[]): Stop[] {
  const next: Stop[] = stops.filter((s) => s.kind === 'address');
  while (next.length < MIN_STOPS) next.push(emptyAddressStop());
  return next;
}

/**
 * Role badge for a row: 'A' for the first filled stop, 'B' for the last
 * filled stop, via numbers between, '·' for empty rows.
 */
export function stopRole(stops: Stop[], index: number): string {
  if (isEmptyStop(stops[index])) {
    // With nothing filled yet, hint the endpoint roles on the empty rows
    if (!stops.some((s) => !isEmptyStop(s))) {
      if (index === 0) return 'A';
      if (index === stops.length - 1) return 'B';
    }
    return '·';
  }
  let filledBefore = 0;
  for (let i = 0; i < index; i++) {
    if (!isEmptyStop(stops[i])) filledBefore++;
  }
  const filledTotal = filledStops(stops).length;
  if (filledBefore === 0) return 'A';
  if (filledBefore === filledTotal - 1) return 'B';
  return String(filledBefore);
}

export type LocationPayload = { address: string } | { lat: number; lng: number };

export interface PayloadLocations {
  origin: LocationPayload;
  destination: LocationPayload;
  via: LocationPayload[];
}

function toLocation(stop: Stop): LocationPayload {
  return stop.kind === 'address'
    ? { address: stop.address.trim() }
    : { lat: stop.lat, lng: stop.lng };
}

/**
 * Derive the /api/quote location payload from the filled stops.
 * Returns null below the minimum of two filled stops.
 */
export function derivePayloadLocations(stops: Stop[]): PayloadLocations | null {
  const filled = filledStops(stops);
  if (filled.length < MIN_STOPS) return null;
  return {
    origin: toLocation(filled[0]),
    destination: toLocation(filled[filled.length - 1]),
    via: filled.slice(1, -1).map(toLocation),
  };
}

/** Point stops with their roles, for planning markers on the map */
export function planningMarkers(stops: Stop[]): PlanningMarker[] {
  const markers: PlanningMarker[] = [];
  stops.forEach((stop, i) => {
    if (stop.kind === 'point') {
      markers.push({ lat: stop.lat, lng: stop.lng, role: stopRole(stops, i) });
    }
  });
  return markers;
}
