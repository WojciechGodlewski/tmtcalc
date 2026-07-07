import { describe, it, expect } from 'vitest';
import { evaluateAdmissibility, buildNoRouteAdmissibility } from './admissibility.js';
import { createRouteFacts, type RouteFacts, type RestrictionSegment } from '../types/route-facts.js';

function makeFacts(overrides: {
  truckRestricted?: boolean;
  restrictionReasons?: string[];
  restrictionSegments?: RestrictionSegment[];
  warnings?: Array<{ code?: string; message?: string }>;
}): RouteFacts {
  return createRouteFacts({
    route: { distanceKm: 430, durationHours: 6, sections: 1 },
    geography: {
      originCountry: 'IT',
      destinationCountry: 'DE',
      countriesCrossed: ['IT', 'AT', 'DE'],
      isInternational: true,
      isEU: true,
    },
    regulatory: {
      truckRestricted: overrides.truckRestricted ?? false,
      restrictionReasons: overrides.restrictionReasons ?? [],
      ...(overrides.restrictionSegments ? { restrictionSegments: overrides.restrictionSegments } : {}),
      adrRequired: null,
      lowEmissionZones: [],
      weightLimitViolations: null,
    },
    raw: { provider: 'here', hereRouteId: 'r1', warnings: overrides.warnings ?? [] },
  });
}

const CRITICAL_SEGMENT: RestrictionSegment = {
  code: 'violatedVehicleRestriction',
  severity: 'critical',
  title: 'Violated vehicle restriction.',
  sectionIndex: 0,
  noticeIndex: 0,
  spanStartOffset: 2,
  spanEndOffset: 3,
  startPoint: { lat: 46.5, lng: 11.35 },
  endPoint: { lat: 47.27, lng: 11.4 },
  approxDistanceFromOriginKm: 121.8,
  details: [],
  restrictionSummary: 'Maximum gross weight: 9000 kg',
};

describe('evaluateAdmissibility', () => {
  it('valid: clean route with pricing model', () => {
    const a = evaluateAdmissibility({
      routeFacts: makeFacts({}),
      excludeCountries: [],
      pricingModelFound: true,
    });
    expect(a.status).toBe('valid');
    expect(a.quoteValid).toBe(true);
    expect(a.routeUsable).toBe(true);
    expect(a.hardConstraintViolation).toBe(false);
    expect(a.failedConstraints).toEqual([]);
    expect(a.reason).toBeNull();
  });

  it('truck_restricted: critical violatedVehicleRestriction segment', () => {
    const a = evaluateAdmissibility({
      routeFacts: makeFacts({
        truckRestricted: true,
        restrictionReasons: ['Violated vehicle restriction.'],
        restrictionSegments: [CRITICAL_SEGMENT],
        warnings: [{ code: 'violatedVehicleRestriction', message: 'Violated vehicle restriction.' }],
      }),
      excludeCountries: ['CHE'],
      pricingModelFound: true,
    });
    expect(a.status).toBe('truck_restricted');
    expect(a.quoteValid).toBe(false);
    expect(a.routeUsable).toBe(false);
    expect(a.hardConstraintViolation).toBe(true);
    expect(a.failedConstraints).toEqual(['vehicle_restriction']);
    expect(a.reason).toBe('Route found, but not valid for selected vehicle.');
    // Distance message from segment start/end points
    expect(a.messages.some((m) => m.includes('km of the route'))).toBe(true);
    // Exclusion clarification present when exclusions were applied
    expect(a.messages.some((m) => m.includes('vehicle passability, not country avoidance'))).toBe(true);
  });

  it('truck_restricted: violated notice without located segments (documented rule)', () => {
    const a = evaluateAdmissibility({
      routeFacts: makeFacts({
        truckRestricted: true,
        restrictionReasons: ['Violated vehicle restriction.'],
        warnings: [{ code: 'violatedVehicleRestriction', message: 'Violated vehicle restriction.' }],
      }),
      excludeCountries: [],
      pricingModelFound: true,
    });
    expect(a.status).toBe('truck_restricted');
    expect(a.quoteValid).toBe(false);
    expect(a.messages.some((m) => m.includes('verify the whole route manually'))).toBe(true);
    // No exclusion note when no exclusions were requested
    expect(a.messages.some((m) => m.includes('country avoidance'))).toBe(false);
  });

  it('warning: truckRestricted without violated-restriction evidence', () => {
    const a = evaluateAdmissibility({
      routeFacts: makeFacts({
        truckRestricted: true,
        restrictionReasons: ['Height restriction ahead'],
        warnings: [{ code: 'truckRestriction', message: 'Height restriction ahead' }],
      }),
      excludeCountries: [],
      pricingModelFound: true,
    });
    expect(a.status).toBe('warning');
    expect(a.quoteValid).toBe(true); // quote stays valid, manual verification required
    expect(a.routeUsable).toBe(true);
    expect(a.hardConstraintViolation).toBe(false);
    expect(a.messages[0]).toContain('Manual verification required');
  });

  it('pricing_unavailable: clean route without a pricing model, lane named in messages', () => {
    const a = evaluateAdmissibility({
      routeFacts: makeFacts({}),
      excludeCountries: [],
      pricingModelFound: false,
      vehicleProfileId: 'solo_18t_23ep',
    });
    expect(a.status).toBe('pricing_unavailable');
    expect(a.quoteValid).toBe(false);
    expect(a.routeUsable).toBe(true);
    expect(a.hardConstraintViolation).toBe(false);
    expect(a.failedConstraints).toEqual(['pricing_model']);
    // The exact lane and vehicle are named so operators see WHY
    expect(a.messages[0]).toBe('No pricing model covers the lane IT → DE for vehicle solo_18t_23ep.');
  });

  it('truck_restricted wins over missing pricing model', () => {
    const a = evaluateAdmissibility({
      routeFacts: makeFacts({
        truckRestricted: true,
        restrictionSegments: [CRITICAL_SEGMENT],
      }),
      excludeCountries: [],
      pricingModelFound: false,
    });
    expect(a.status).toBe('truck_restricted');
    expect(a.quoteValid).toBe(false);
    expect(a.routeUsable).toBe(false);
  });
});

describe('buildNoRouteAdmissibility', () => {
  it('mentions exclusions when they were requested', () => {
    const a = buildNoRouteAdmissibility(['CHE']);
    expect(a.status).toBe('no_route');
    expect(a.quoteValid).toBe(false);
    expect(a.routeUsable).toBe(false);
    expect(a.hardConstraintViolation).toBe(true);
    expect(a.failedConstraints).toEqual(['route_not_found']);
    expect(a.reason).toBe('No route found with selected country exclusions.');
    expect(buildNoRouteAdmissibility([]).reason).toBe('No route found between origin and destination.');
  });
});
