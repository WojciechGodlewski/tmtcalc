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
});

/**
 * Infrastructure elements along the route
 */
export const InfrastructureSchema = z.object({
  hasFerry: z.boolean(),
  ferrySegments: z.number().int().nonnegative(),
  hasTollRoads: z.boolean(),
  tollCountries: z.array(z.string()),
  tollCostEstimate: z.number().nonnegative().nullable(),
  hasTunnel: z.boolean(),
  tunnels: z.array(TunnelSchema),
});

/**
 * Regulatory constraints and requirements
 */
export const RegulatorySchema = z.object({
  truckRestricted: z.boolean(),
  restrictionReasons: z.array(z.string()),
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
  },
  infrastructure: {
    hasFerry: false,
    ferrySegments: 0,
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
      tollCountries: updates.infrastructure?.tollCountries ?? base.infrastructure.tollCountries,
      tunnels: updates.infrastructure?.tunnels ?? base.infrastructure.tunnels,
    },
    regulatory: {
      ...base.regulatory,
      ...updates.regulatory,
      restrictionReasons: updates.regulatory?.restrictionReasons ?? base.regulatory.restrictionReasons,
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
