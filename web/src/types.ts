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

export interface QuoteDebug {
  resolvedPoints?: unknown;
  hereRequest?: {
    viaCount?: number;
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

export interface QuoteResponse {
  quote: Quote;
  routeFacts: RouteFacts;
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
}
