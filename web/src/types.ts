/**
 * Pragmatic typings for the /api/quote response.
 * Mirrors the backend shapes (src/pricing/types.ts, src/types/route-facts.ts)
 * closely enough for rendering; optional/nullable where the backend allows it.
 */

export interface SurchargeLineItem {
  type: string;
  description: string;
  amount: number;
}

export interface Quote {
  modelId: string;
  modelName: string;
  distanceKm: number;
  lineItems: {
    kmCharge: number;
    emptiesCharge: number;
    surcharges: SurchargeLineItem[];
    minimumAdjustment: number | null;
  };
  finalPrice: number;
  currency: string;
}

export interface Tunnel {
  name: string | null;
  category: string | null;
  country: string | null;
}

/** Human-readable location near a restriction segment (reverse-geocoded) */
export interface SegmentLocation {
  label: string;
  city?: string | null;
  district?: string | null;
  county?: string | null;
  state?: string | null;
  countryCode?: string | null;
  street?: string | null;
  source: 'here_reverse_geocode';
}

/** A concrete route segment where a vehicle restriction applies */
export interface RestrictionSegment {
  code: string;
  severity: string;
  title: string;
  sectionIndex: number;
  noticeIndex: number;
  spanStartOffset: number;
  spanEndOffset: number | null;
  startPoint: { lat: number; lng: number } | null;
  endPoint: { lat: number; lng: number } | null;
  approxDistanceFromOriginKm: number | null;
  details: unknown[];
  restrictionSummary: string;
  /** Midpoint used for the reverse-geocoded location */
  midPoint?: { lat: number; lng: number } | null;
  /** Nearby location label; null when lookup failed or was skipped */
  location?: SegmentLocation | null;
}

export interface RouteFacts {
  route: {
    distanceKm: number;
    durationHours: number | null;
    sections: number | null;
  };
  geography: {
    originCountry: string | null;
    destinationCountry: string | null;
    countriesCrossed: string[];
    isInternational: boolean | null;
    isEU: boolean | null;
  };
  infrastructure: {
    hasFerry: boolean;
    ferrySegments: number;
    hasTollRoads: boolean;
    tollCountries: string[];
    tollCostEstimate: number | null;
    hasTunnel: boolean;
    tunnels: Tunnel[];
  };
  regulatory: {
    truckRestricted: boolean;
    restrictionReasons: string[];
    /** Located restriction segments (from HERE spans=notices); absent when unavailable */
    restrictionSegments?: RestrictionSegment[];
  };
  riskFlags: {
    isUK: boolean;
    isIsland: boolean;
    crossesAlps: boolean;
    isScandinavia: boolean;
    isBaltic: boolean;
  };
  raw: {
    provider: string;
    warnings: Array<{ code?: string; message?: string }>;
  };
}

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

/** A geocoded point echoed back in debug.resolvedPoints */
export interface ResolvedPoint {
  lat: number;
  lng: number;
  label?: string;
  countryCode?: string | null;
  source?: string;
}

export interface ResolvedPoints {
  origin?: ResolvedPoint;
  destination?: ResolvedPoint;
  waypoints?: ResolvedPoint[];
}

export interface QuoteDebug {
  resolvedPoints?: ResolvedPoints;
  hereRequest?: {
    viaCount?: number;
    /** Normalized alpha-3 codes sent to HERE as exclude[countries] */
    excludeCountries?: string[];
  };
  hereResponse?: {
    alpsMatch?: { frejus: boolean; montBlanc: boolean };
    alpsMatchReason?: { frejus: string; montBlanc: string };
    polylineFirstPoint?: { lat: number; lng: number } | null;
    polylineBounds?: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null;
    polylineSwapApplied?: boolean;
    firstPointLngPatched?: boolean;
  };
}

export type AdmissibilityStatus =
  | 'valid'
  | 'warning'
  | 'truck_restricted'
  | 'no_route'
  | 'pricing_unavailable';

export type FailedConstraint =
  | 'route_not_found'
  | 'excluded_country'
  | 'vehicle_restriction'
  | 'pricing_model';

/** Source of truth for route/quote validity */
export interface Admissibility {
  status: AdmissibilityStatus;
  quoteValid: boolean;
  routeUsable: boolean;
  hardConstraintViolation: boolean;
  reason: string | null;
  messages: string[];
  failedConstraints: FailedConstraint[];
}

export interface QuoteResponse {
  /** Absent only on older backends; treat missing as valid */
  admissibility?: Admissibility;
  /** Absent when admissibility.status is pricing_unavailable */
  quote?: Quote & { validForOperations?: boolean };
  routeFacts: RouteFacts;
  /** Present only when the request sets includeGeometry: true */
  routeGeometry?: RouteGeometry;
  debug?: QuoteDebug;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type VehicleProfileId = 'solo_18t_23ep' | 'van_8ep' | 'ftl_13_6_33ep';

export interface QuoteRequest {
  origin: { address: string };
  destination: { address: string };
  via?: Array<{ address: string }>;
  vehicleProfileId: VehicleProfileId;
  /** Ask the backend for decoded route geometry (map display) */
  includeGeometry?: boolean;
  /** Strict country exclusion (alpha-2 or alpha-3 codes) */
  excludeCountries?: string[];
}
