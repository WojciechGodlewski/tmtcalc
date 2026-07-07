import { z } from 'zod/v4';

/**
 * Tunnel information within a route
 */
export const TunnelSchema = z.object({
  name: z.string().nullable(),
  category: z.string().nullable(),
  country: z.string().nullable(),
});

/**
 * Warning from route provider
 */
export const WarningSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
});

/**
 * A sea/Channel crossing along the route. HERE reports these as sections with
 * transport mode 'ferry' or 'carShuttleTrain' (Eurotunnel Le Shuttle Freight).
 */
export const CrossingSchema = z.object({
  type: z.enum(['ferry', 'shuttleTrain']),
});

/**
 * Route distance and duration information
 */
export const RouteSchema = z.object({
  distanceKm: z.number().nonnegative(),
  durationHours: z.number().nonnegative().nullable(),
  sections: z.number().int().nonnegative().nullable(),
});

/**
 * Geographic information about the route
 */
export const GeographySchema = z.object({
  originCountry: z.string().nullable(),
  destinationCountry: z.string().nullable(),
  countriesCrossed: z.array(z.string()),
  isInternational: z.boolean().nullable(),
  isEU: z.boolean().nullable(),
  /**
   * Number of UK entries/exits along the ordered stop sequence
   * (origin -> waypoints -> destination). Drives the per-crossing UK
   * surcharge: a round trip EU -> UK -> EU counts 2. Defaults to 0;
   * falls back to 1 when the route touches the UK but no stop-level
   * transition is detectable (see applyResolvedGeography).
   */
  ukCrossings: z.number().int().nonnegative().default(0),
});

/**
 * Infrastructure elements along the route
 */
export const InfrastructureSchema = z.object({
  hasFerry: z.boolean(),
  ferrySegments: z.number().int().nonnegative(),
  /**
   * All sea/Channel crossings in section order, labeled by type. Supersedes
   * hasFerry/ferrySegments (kept for backward compatibility): a Eurotunnel
   * shuttle-train leg appears here but is NOT a ferry segment.
   */
  crossings: z.array(CrossingSchema).default([]),
  hasTollRoads: z.boolean(),
  tollCountries: z.array(z.string()),
  tollCostEstimate: z.number().nonnegative().nullable(),
  hasTunnel: z.boolean(),
  tunnels: z.array(TunnelSchema),
});

/**
 * A concrete route segment where a vehicle restriction applies,
 * derived from HERE spans=notices (see src/here/restriction-segments.ts)
 */
/**
 * Human-readable location near a restriction segment, reverse-geocoded from
 * the segment midpoint (best effort - never affects quote validity)
 */
export const SegmentLocationSchema = z.object({
  label: z.string(),
  city: z.string().nullable().optional(),
  district: z.string().nullable().optional(),
  county: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  countryCode: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  source: z.literal('here_reverse_geocode'),
});

/**
 * Normalized user-facing display for a restriction segment - the only
 * restriction text the main UI renders (raw HERE syntax stays in `details`)
 */
export const RestrictionDisplaySchema = z.object({
  title: z.string(),
  message: z.string(),
  severityLabel: z.enum(['critical', 'warning', 'info']),
  manualVerificationRequired: z.boolean(),
  rawDetailsHidden: z.boolean(),
});

export const RestrictionSegmentSchema = z.object({
  code: z.string(),
  severity: z.string(),
  title: z.string(),
  sectionIndex: z.number().int().nonnegative(),
  noticeIndex: z.number().int().nonnegative(),
  spanStartOffset: z.number().int().nonnegative(),
  spanEndOffset: z.number().int().nonnegative().nullable(),
  startPoint: z.object({ lat: z.number(), lng: z.number() }).nullable(),
  endPoint: z.object({ lat: z.number(), lng: z.number() }).nullable(),
  approxDistanceFromOriginKm: z.number().nullable(),
  details: z.array(z.unknown()),
  restrictionSummary: z.string(),
  /** Midpoint used for the reverse-geocoded location (when computable) */
  midPoint: z.object({ lat: z.number(), lng: z.number() }).nullable().optional(),
  /** Reverse-geocoded nearby location; null when lookup failed/skipped */
  location: SegmentLocationSchema.nullable().optional(),
  /** Normalized user-facing text (optional for backward compatibility) */
  display: RestrictionDisplaySchema.optional(),
});

/**
 * Regulatory constraints and requirements
 */
export const RegulatorySchema = z.object({
  truckRestricted: z.boolean(),
  restrictionReasons: z.array(z.string()),
  /** Located restriction segments; absent when HERE provides no span data */
  restrictionSegments: z.array(RestrictionSegmentSchema).optional(),
  adrRequired: z.boolean().nullable(),
  lowEmissionZones: z.array(z.string()),
  weightLimitViolations: z.boolean().nullable(),
});

/**
 * Risk flags for special route conditions
 */
export const RiskFlagsSchema = z.object({
  isUK: z.boolean(),
  isIsland: z.boolean(),
  crossesAlps: z.boolean(),
  isScandinavia: z.boolean(),
  isBaltic: z.boolean(),
});

/**
 * Raw provider data
 */
export const RawSchema = z.object({
  provider: z.literal('here'),
  hereRouteId: z.string().nullable(),
  warnings: z.array(WarningSchema),
});

/**
 * Complete RouteFacts schema
 * Canonical definition of route analysis data
 */
export const RouteFactsSchema = z.object({
  route: RouteSchema,
  geography: GeographySchema,
  infrastructure: InfrastructureSchema,
  regulatory: RegulatorySchema,
  riskFlags: RiskFlagsSchema,
  raw: RawSchema,
});

// Type exports inferred from schemas
export type RestrictionDisplay = z.infer<typeof RestrictionDisplaySchema>;
export type SegmentLocation = z.infer<typeof SegmentLocationSchema>;
export type RestrictionSegment = z.infer<typeof RestrictionSegmentSchema>;
export type Crossing = z.infer<typeof CrossingSchema>;
export type Tunnel = z.infer<typeof TunnelSchema>;
export type Warning = z.infer<typeof WarningSchema>;
export type Route = z.infer<typeof RouteSchema>;
export type Geography = z.infer<typeof GeographySchema>;
export type Infrastructure = z.infer<typeof InfrastructureSchema>;
export type Regulatory = z.infer<typeof RegulatorySchema>;
export type RiskFlags = z.infer<typeof RiskFlagsSchema>;
export type Raw = z.infer<typeof RawSchema>;
export type RouteFacts = z.infer<typeof RouteFactsSchema>;

// Partial types for update operations
export type PartialRouteFacts = {
  route?: Partial<Route>;
  geography?: Partial<Geography>;
  infrastructure?: Partial<Infrastructure>;
  regulatory?: Partial<Regulatory>;
  riskFlags?: Partial<RiskFlags>;
  raw?: Partial<Raw>;
};

/**
 * Default values for creating empty RouteFacts
 */
export const DEFAULT_ROUTE_FACTS: RouteFacts = {
  route: {
    distanceKm: 0,
    durationHours: null,
    sections: null,
  },
  geography: {
    originCountry: null,
    destinationCountry: null,
    countriesCrossed: [],
    isInternational: null,
    isEU: null,
    ukCrossings: 0,
  },
  infrastructure: {
    hasFerry: false,
    ferrySegments: 0,
    crossings: [],
    hasTollRoads: false,
    tollCountries: [],
    tollCostEstimate: null,
    hasTunnel: false,
    tunnels: [],
  },
  regulatory: {
    truckRestricted: false,
    restrictionReasons: [],
    adrRequired: null,
    lowEmissionZones: [],
    weightLimitViolations: null,
  },
  riskFlags: {
    isUK: false,
    isIsland: false,
    crossesAlps: false,
    isScandinavia: false,
    isBaltic: false,
  },
  raw: {
    provider: 'here',
    hereRouteId: null,
    warnings: [],
  },
};

/**
 * Validates and parses unknown data into RouteFacts
 * @throws ZodError if validation fails
 */
export function parseRouteFacts(data: unknown): RouteFacts {
  return RouteFactsSchema.parse(data);
}

/**
 * Safely validates data, returning result object
 */
export function safeParseRouteFacts(data: unknown) {
  return RouteFactsSchema.safeParse(data);
}

/**
 * Creates a new RouteFacts with defaults merged with partial data
 */
export function createRouteFacts(partial: Partial<RouteFacts> = {}): RouteFacts {
  return {
    route: { ...DEFAULT_ROUTE_FACTS.route, ...partial.route },
    geography: { ...DEFAULT_ROUTE_FACTS.geography, ...partial.geography },
    infrastructure: { ...DEFAULT_ROUTE_FACTS.infrastructure, ...partial.infrastructure },
    regulatory: { ...DEFAULT_ROUTE_FACTS.regulatory, ...partial.regulatory },
    riskFlags: { ...DEFAULT_ROUTE_FACTS.riskFlags, ...partial.riskFlags },
    raw: { ...DEFAULT_ROUTE_FACTS.raw, ...partial.raw },
  };
}

/**
 * Deep merges partial updates into existing RouteFacts
 */
export function mergeRouteFacts(base: RouteFacts, updates: PartialRouteFacts): RouteFacts {
  return {
    route: { ...base.route, ...updates.route },
    geography: {
      ...base.geography,
      ...updates.geography,
      countriesCrossed: updates.geography?.countriesCrossed ?? base.geography.countriesCrossed,
    },
    infrastructure: {
      ...base.infrastructure,
      ...updates.infrastructure,
      crossings: updates.infrastructure?.crossings ?? base.infrastructure.crossings,
      tollCountries: updates.infrastructure?.tollCountries ?? base.infrastructure.tollCountries,
      tunnels: updates.infrastructure?.tunnels ?? base.infrastructure.tunnels,
    },
    regulatory: {
      ...base.regulatory,
      ...updates.regulatory,
      restrictionReasons: updates.regulatory?.restrictionReasons ?? base.regulatory.restrictionReasons,
      restrictionSegments: updates.regulatory?.restrictionSegments ?? base.regulatory.restrictionSegments,
      lowEmissionZones: updates.regulatory?.lowEmissionZones ?? base.regulatory.lowEmissionZones,
    },
    riskFlags: { ...base.riskFlags, ...updates.riskFlags },
    raw: {
      ...base.raw,
      ...updates.raw,
      warnings: updates.raw?.warnings ?? base.raw.warnings,
    },
  };
}
