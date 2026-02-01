import { describe, it, expect } from 'vitest';
import {
  RouteFactsSchema,
  parseRouteFacts,
  safeParseRouteFacts,
  createRouteFacts,
  mergeRouteFacts,
  DEFAULT_ROUTE_FACTS,
  type RouteFacts,
} from './route-facts.js';

describe('RouteFacts Schema', () => {
  const validRouteFacts: RouteFacts = {
    route: {
      distanceKm: 450.5,
      durationHours: 5.5,
      sections: 3,
    },
    geography: {
      originCountry: 'DE',
      destinationCountry: 'PL',
      countriesCrossed: ['DE', 'PL'],
      isInternational: true,
      isEU: true,
    },
    infrastructure: {
      hasFerry: false,
      ferrySegments: 0,
      hasTollRoads: true,
      tollCountries: ['DE', 'PL'],
      tollCostEstimate: 45.0,
      hasTunnel: false,
      tunnels: [],
    },
    regulatory: {
      truckRestricted: false,
      restrictionReasons: [],
      adrRequired: false,
      lowEmissionZones: ['Berlin'],
      weightLimitViolations: false,
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
      hereRouteId: 'route-123',
      warnings: [],
    },
  };

  describe('validation', () => {
    it('accepts valid RouteFacts', () => {
      const result = RouteFactsSchema.safeParse(validRouteFacts);
      expect(result.success).toBe(true);
    });

    it('accepts nullable fields as null', () => {
      const withNulls: RouteFacts = {
        ...validRouteFacts,
        route: {
          distanceKm: 100,
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
      };
      const result = RouteFactsSchema.safeParse(withNulls);
      expect(result.success).toBe(true);
    });

    it('rejects negative distanceKm', () => {
      const invalid = {
        ...validRouteFacts,
        route: { ...validRouteFacts.route, distanceKm: -10 },
      };
      const result = RouteFactsSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('rejects negative durationHours', () => {
      const invalid = {
        ...validRouteFacts,
        route: { ...validRouteFacts.route, durationHours: -1 },
      };
      const result = RouteFactsSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('rejects invalid provider', () => {
      const invalid = {
        ...validRouteFacts,
        raw: { ...validRouteFacts.raw, provider: 'google' },
      };
      const result = RouteFactsSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('validates tunnel structure', () => {
      const withTunnels: RouteFacts = {
        ...validRouteFacts,
        infrastructure: {
          ...validRouteFacts.infrastructure,
          hasTunnel: true,
          tunnels: [
            { name: 'Gotthard', category: 'base', country: 'CH' },
            { name: null, category: null, country: null },
          ],
        },
      };
      const result = RouteFactsSchema.safeParse(withTunnels);
      expect(result.success).toBe(true);
    });

    it('validates warnings structure', () => {
      const withWarnings: RouteFacts = {
        ...validRouteFacts,
        raw: {
          ...validRouteFacts.raw,
          warnings: [
            { code: 'W001', message: 'Road construction ahead' },
            { code: 'W002' },
            { message: 'Traffic delay expected' },
            {},
          ],
        },
      };
      const result = RouteFactsSchema.safeParse(withWarnings);
      expect(result.success).toBe(true);
    });

    it('rejects missing required fields', () => {
      const invalid = {
        route: validRouteFacts.route,
        // missing other required fields
      };
      const result = RouteFactsSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('parseRouteFacts', () => {
    it('returns parsed data for valid input', () => {
      const parsed = parseRouteFacts(validRouteFacts);
      expect(parsed).toEqual(validRouteFacts);
    });

    it('throws for invalid input', () => {
      expect(() => parseRouteFacts({ invalid: true })).toThrow();
    });
  });

  describe('safeParseRouteFacts', () => {
    it('returns success for valid input', () => {
      const result = safeParseRouteFacts(validRouteFacts);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validRouteFacts);
      }
    });

    it('returns error for invalid input', () => {
      const result = safeParseRouteFacts({ invalid: true });
      expect(result.success).toBe(false);
    });
  });

  describe('createRouteFacts', () => {
    it('returns defaults when called with no arguments', () => {
      const facts = createRouteFacts();
      expect(facts).toEqual(DEFAULT_ROUTE_FACTS);
    });

    it('merges partial route data', () => {
      const facts = createRouteFacts({
        route: { distanceKm: 250, durationHours: 3, sections: 2 },
      });
      expect(facts.route.distanceKm).toBe(250);
      expect(facts.route.durationHours).toBe(3);
      expect(facts.geography).toEqual(DEFAULT_ROUTE_FACTS.geography);
    });

    it('merges partial geography data', () => {
      const facts = createRouteFacts({
        geography: {
          originCountry: 'FR',
          destinationCountry: 'IT',
          countriesCrossed: ['FR', 'IT'],
          isInternational: true,
          isEU: true,
        },
      });
      expect(facts.geography.originCountry).toBe('FR');
      expect(facts.geography.countriesCrossed).toEqual(['FR', 'IT']);
    });

    it('merges partial riskFlags data', () => {
      const facts = createRouteFacts({
        riskFlags: { isUK: true, isIsland: true, crossesAlps: false, isScandinavia: false, isBaltic: false },
      });
      expect(facts.riskFlags.isUK).toBe(true);
      expect(facts.riskFlags.isIsland).toBe(true);
    });
  });

  describe('mergeRouteFacts', () => {
    it('merges updates into base', () => {
      const base = createRouteFacts();
      const updated = mergeRouteFacts(base, {
        route: { distanceKm: 500, durationHours: 6, sections: 4 },
        riskFlags: { isUK: false, isIsland: false, crossesAlps: true, isScandinavia: false, isBaltic: false },
      });

      expect(updated.route.distanceKm).toBe(500);
      expect(updated.riskFlags.crossesAlps).toBe(true);
      expect(updated.geography).toEqual(base.geography);
    });

    it('preserves base arrays when not overridden', () => {
      const base = createRouteFacts({
        geography: {
          originCountry: 'DE',
          destinationCountry: 'FR',
          countriesCrossed: ['DE', 'FR'],
          isInternational: true,
          isEU: true,
        },
      });
      const updated = mergeRouteFacts(base, {
        geography: { originCountry: 'NL', destinationCountry: null, isInternational: null, isEU: null },
      });

      expect(updated.geography.originCountry).toBe('NL');
      expect(updated.geography.countriesCrossed).toEqual(['DE', 'FR']);
    });

    it('replaces arrays when provided in updates', () => {
      const base = createRouteFacts({
        infrastructure: {
          hasFerry: false,
          ferrySegments: 0,
          hasTollRoads: true,
          tollCountries: ['DE'],
          tollCostEstimate: null,
          hasTunnel: false,
          tunnels: [],
        },
      });
      const updated = mergeRouteFacts(base, {
        infrastructure: {
          hasFerry: false,
          ferrySegments: 0,
          hasTollRoads: true,
          tollCountries: ['DE', 'FR', 'IT'],
          tollCostEstimate: null,
          hasTunnel: false,
          tunnels: [],
        },
      });

      expect(updated.infrastructure.tollCountries).toEqual(['DE', 'FR', 'IT']);
    });
  });

  describe('DEFAULT_ROUTE_FACTS', () => {
    it('is valid according to schema', () => {
      const result = RouteFactsSchema.safeParse(DEFAULT_ROUTE_FACTS);
      expect(result.success).toBe(true);
    });

    it('has provider set to here', () => {
      expect(DEFAULT_ROUTE_FACTS.raw.provider).toBe('here');
    });

    it('has all boolean flags set to false', () => {
      expect(DEFAULT_ROUTE_FACTS.infrastructure.hasFerry).toBe(false);
      expect(DEFAULT_ROUTE_FACTS.infrastructure.hasTollRoads).toBe(false);
      expect(DEFAULT_ROUTE_FACTS.infrastructure.hasTunnel).toBe(false);
      expect(DEFAULT_ROUTE_FACTS.regulatory.truckRestricted).toBe(false);
      expect(DEFAULT_ROUTE_FACTS.riskFlags.isUK).toBe(false);
      expect(DEFAULT_ROUTE_FACTS.riskFlags.isIsland).toBe(false);
      expect(DEFAULT_ROUTE_FACTS.riskFlags.crossesAlps).toBe(false);
      expect(DEFAULT_ROUTE_FACTS.riskFlags.isScandinavia).toBe(false);
      expect(DEFAULT_ROUTE_FACTS.riskFlags.isBaltic).toBe(false);
    });

    it('has all arrays empty', () => {
      expect(DEFAULT_ROUTE_FACTS.geography.countriesCrossed).toEqual([]);
      expect(DEFAULT_ROUTE_FACTS.infrastructure.tollCountries).toEqual([]);
      expect(DEFAULT_ROUTE_FACTS.infrastructure.tunnels).toEqual([]);
      expect(DEFAULT_ROUTE_FACTS.regulatory.restrictionReasons).toEqual([]);
      expect(DEFAULT_ROUTE_FACTS.regulatory.lowEmissionZones).toEqual([]);
      expect(DEFAULT_ROUTE_FACTS.raw.warnings).toEqual([]);
    });
  });
});
