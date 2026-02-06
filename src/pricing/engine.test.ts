import { describe, it, expect } from 'vitest';
import {
  findMatchingModel,
  calculatePrice,
  calculateQuote,
} from './engine.js';
import { SOLO_MODELS } from './market-models.js';
import { createRouteFacts, type RouteFacts } from '../types/route-facts.js';

/**
 * Create a test RouteFacts with specified values
 */
function createTestRouteFacts(overrides: {
  distanceKm?: number;
  originCountry?: string | null;
  destinationCountry?: string | null;
  countriesCrossed?: string[];
  isUK?: boolean;
  crossesAlps?: boolean;
  hasTunnel?: boolean;
  tunnels?: Array<{ name: string | null; category: string | null; country: string | null }>;
}): RouteFacts {
  return createRouteFacts({
    route: {
      distanceKm: overrides.distanceKm ?? 500,
      durationHours: 6,
      sections: 1,
    },
    geography: {
      originCountry: overrides.originCountry ?? 'POL',
      destinationCountry: overrides.destinationCountry ?? 'DEU',
      countriesCrossed: overrides.countriesCrossed ?? ['POL', 'DEU'],
      isInternational: true,
      isEU: true,
    },
    infrastructure: {
      hasFerry: false,
      ferrySegments: 0,
      hasTollRoads: true,
      tollCountries: ['DEU'],
      tollCostEstimate: null,
      hasTunnel: overrides.hasTunnel ?? false,
      tunnels: overrides.tunnels ?? [],
    },
    riskFlags: {
      isUK: overrides.isUK ?? false,
      isIsland: false,
      crossesAlps: overrides.crossesAlps ?? false,
      isScandinavia: false,
      isBaltic: false,
    },
  });
}

describe('Pricing Engine', () => {
  describe('findMatchingModel', () => {
    it('finds SOLO PL -> EU model for Poland to Germany route', () => {
      const routeFacts = createTestRouteFacts({
        originCountry: 'POL',
        destinationCountry: 'DEU',
      });

      const model = findMatchingModel('solo_18t_23ep', routeFacts);

      expect(model).not.toBeNull();
      expect(model?.id).toBe('solo-pl-eu');
    });

    it('finds SOLO IT -> EU model for Italy to Germany route', () => {
      const routeFacts = createTestRouteFacts({
        originCountry: 'ITA',
        destinationCountry: 'DEU',
      });

      const model = findMatchingModel('solo_18t_23ep', routeFacts);

      expect(model).not.toBeNull();
      expect(model?.id).toBe('solo-it-eu');
    });

    it('returns null for unsupported lane', () => {
      const routeFacts = createTestRouteFacts({
        originCountry: 'ESP', // Spain - not in our models
        destinationCountry: 'PRT', // Portugal
      });

      const model = findMatchingModel('solo_18t_23ep', routeFacts);

      expect(model).toBeNull();
    });

    it('returns null for unknown vehicle profile', () => {
      const routeFacts = createTestRouteFacts({
        originCountry: 'POL',
        destinationCountry: 'DEU',
      });

      const model = findMatchingModel('unknown_profile' as any, routeFacts);

      expect(model).toBeNull();
    });
  });

  describe('SOLO PL -> EU pricing', () => {
    const model = SOLO_MODELS.find((m) => m.id === 'solo-pl-eu')!;

    it('calculates basic price: (routeKm + 200) * 1.0', () => {
      const routeFacts = createTestRouteFacts({
        distanceKm: 500,
        originCountry: 'POL',
        destinationCountry: 'DEU',
      });

      const result = calculatePrice(model, routeFacts);

      // (500 + 200) * 1.0 = 700
      expect(result.lineItems.kmCharge).toBe(500);
      expect(result.lineItems.emptiesCharge).toBe(200);
      expect(result.finalPrice).toBe(700);
    });

    it('adds UK surcharge when destination is UK', () => {
      const routeFacts = createTestRouteFacts({
        distanceKm: 800,
        originCountry: 'POL',
        destinationCountry: 'GBR',
        isUK: true,
      });

      const result = calculatePrice(model, routeFacts);

      // (800 + 200) * 1.0 + 400 = 1400
      expect(result.lineItems.kmCharge).toBe(800);
      expect(result.lineItems.emptiesCharge).toBe(200);
      expect(result.lineItems.surcharges).toHaveLength(1);
      expect(result.lineItems.surcharges[0].type).toBe('ukFerry');
      expect(result.lineItems.surcharges[0].amount).toBe(400);
      expect(result.finalPrice).toBe(1400);
    });

    it('no minimum is applied (no minimum configured)', () => {
      const routeFacts = createTestRouteFacts({
        distanceKm: 100, // Very short route
        originCountry: 'POL',
        destinationCountry: 'DEU',
      });

      const result = calculatePrice(model, routeFacts);

      // (100 + 200) * 1.0 = 300, no minimum
      expect(result.finalPrice).toBe(300);
      expect(result.lineItems.minimumAdjustment).toBeNull();
    });
  });

  describe('SOLO IT -> EU pricing', () => {
    const model = SOLO_MODELS.find((m) => m.id === 'solo-it-eu')!;

    it('calculates basic price: (routeKm * 1.2) + 200', () => {
      const routeFacts = createTestRouteFacts({
        distanceKm: 1000, // Use 1000km so price exceeds minimum
        originCountry: 'ITA',
        destinationCountry: 'DEU',
      });

      const result = calculatePrice(model, routeFacts);

      // 1000 * 1.2 + 200 = 1400 (above 1200 minimum)
      expect(result.lineItems.kmCharge).toBe(1200);
      expect(result.lineItems.emptiesCharge).toBe(200);
      expect(result.lineItems.minimumAdjustment).toBeNull();
      expect(result.finalPrice).toBe(1400);
    });

    it('applies default minimum 1200 for non-UK routes', () => {
      const routeFacts = createTestRouteFacts({
        distanceKm: 300, // Short route
        originCountry: 'ITA',
        destinationCountry: 'DEU',
      });

      const result = calculatePrice(model, routeFacts);

      // 300 * 1.2 + 200 = 560 < 1200, so minimum applies
      expect(result.lineItems.kmCharge).toBe(360);
      expect(result.lineItems.emptiesCharge).toBe(200);
      expect(result.lineItems.minimumAdjustment).toBe(640); // 1200 - 560
      expect(result.finalPrice).toBe(1200);
    });

    it('applies UK minimum 2700 for UK routes', () => {
      const routeFacts = createTestRouteFacts({
        distanceKm: 1000,
        originCountry: 'ITA',
        destinationCountry: 'GBR',
        isUK: true,
      });

      const result = calculatePrice(model, routeFacts);

      // 1000 * 1.2 + 200 + 400 (UK surcharge) = 1800 < 2700
      const subtotal = 1200 + 200 + 400;
      expect(result.lineItems.minimumAdjustment).toBe(2700 - subtotal);
      expect(result.finalPrice).toBe(2700);
    });

    it('adds Fréjus tunnel surcharge', () => {
      const routeFacts = createTestRouteFacts({
        distanceKm: 800,
        originCountry: 'ITA',
        destinationCountry: 'FRA',
        crossesAlps: true,
        hasTunnel: true,
        tunnels: [{ name: 'Fréjus Tunnel', category: 'alpine', country: 'FRA/ITA' }],
      });

      const result = calculatePrice(model, routeFacts);

      // 800 * 1.2 + 200 + 200 (tunnel) = 1360
      expect(result.lineItems.surcharges).toHaveLength(1);
      expect(result.lineItems.surcharges[0].type).toBe('alpsTunnel');
      expect(result.lineItems.surcharges[0].amount).toBe(200);
      expect(result.finalPrice).toBe(1360);
    });

    it('adds Mont Blanc tunnel surcharge', () => {
      const routeFacts = createTestRouteFacts({
        distanceKm: 600,
        originCountry: 'ITA',
        destinationCountry: 'FRA',
        crossesAlps: true,
        hasTunnel: true,
        tunnels: [{ name: 'Mont Blanc Tunnel', category: 'alpine', country: 'FRA/ITA' }],
      });

      const result = calculatePrice(model, routeFacts);

      expect(result.lineItems.surcharges.some((s) => s.type === 'alpsTunnel')).toBe(true);
    });

    it('applies both UK and tunnel surcharges', () => {
      const routeFacts = createTestRouteFacts({
        distanceKm: 1500,
        originCountry: 'ITA',
        destinationCountry: 'GBR',
        isUK: true,
        crossesAlps: true,
        hasTunnel: true,
        tunnels: [{ name: 'Fréjus Tunnel', category: 'alpine', country: 'FRA/ITA' }],
      });

      const result = calculatePrice(model, routeFacts);

      // 1500 * 1.2 + 200 + 400 (UK) + 200 (tunnel) = 2600 < 2700 UK min
      expect(result.lineItems.surcharges).toHaveLength(2);
      expect(result.lineItems.surcharges.some((s) => s.type === 'ukFerry')).toBe(true);
      expect(result.lineItems.surcharges.some((s) => s.type === 'alpsTunnel')).toBe(true);
      expect(result.finalPrice).toBe(2700); // UK minimum applies
    });

    it('does not apply minimum when price exceeds it', () => {
      const routeFacts = createTestRouteFacts({
        distanceKm: 2000, // Long route
        originCountry: 'ITA',
        destinationCountry: 'DEU',
      });

      const result = calculatePrice(model, routeFacts);

      // 2000 * 1.2 + 200 = 2600 > 1200
      expect(result.lineItems.minimumAdjustment).toBeNull();
      expect(result.finalPrice).toBe(2600);
    });
  });

  describe('SOLO IT -> UK pricing', () => {
    it('selects solo-it-uk model for IT to GB route', () => {
      const routeFacts = createTestRouteFacts({
        distanceKm: 1500,
        originCountry: 'ITA',
        destinationCountry: 'GB',
        isUK: true,
      });

      const model = findMatchingModel('solo_18t_23ep', routeFacts);

      expect(model).not.toBeNull();
      expect(model?.id).toBe('solo-it-uk');
      expect(model?.name).toBe('SOLO IT -> UK');
    });

    it('selects solo-it-uk model for IT to UK (variant) route', () => {
      const routeFacts = createTestRouteFacts({
        distanceKm: 1500,
        originCountry: 'ITA',
        destinationCountry: 'UK',
        isUK: true,
      });

      const model = findMatchingModel('solo_18t_23ep', routeFacts);

      expect(model).not.toBeNull();
      expect(model?.id).toBe('solo-it-uk');
    });

    it('calculates price with UK crossing surcharge always applied', () => {
      const model = SOLO_MODELS.find((m) => m.id === 'solo-it-uk')!;
      const routeFacts = createTestRouteFacts({
        distanceKm: 1500,
        originCountry: 'ITA',
        destinationCountry: 'GB',
        isUK: true,
      });

      const result = calculatePrice(model, routeFacts);

      // 1500 * 1.2 + 200 + 400 (UK surcharge) = 2400 < 2700 min
      expect(result.lineItems.kmCharge).toBe(1800);
      expect(result.lineItems.emptiesCharge).toBe(200);
      expect(result.lineItems.surcharges).toHaveLength(1);
      expect(result.lineItems.surcharges[0].type).toBe('ukFerry');
      expect(result.lineItems.surcharges[0].amount).toBe(400);
    });

    it('applies minimum 2700 EUR for short routes', () => {
      const model = SOLO_MODELS.find((m) => m.id === 'solo-it-uk')!;
      const routeFacts = createTestRouteFacts({
        distanceKm: 1000,
        originCountry: 'ITA',
        destinationCountry: 'GB',
        isUK: true,
      });

      const result = calculatePrice(model, routeFacts);

      // 1000 * 1.2 + 200 + 400 = 1800 < 2700 min
      const subtotal = 1200 + 200 + 400;
      expect(result.lineItems.minimumAdjustment).toBe(2700 - subtotal);
      expect(result.finalPrice).toBe(2700);
    });

    it('does not apply minimum when price exceeds 2700', () => {
      const model = SOLO_MODELS.find((m) => m.id === 'solo-it-uk')!;
      const routeFacts = createTestRouteFacts({
        distanceKm: 2500, // Long route
        originCountry: 'ITA',
        destinationCountry: 'GB',
        isUK: true,
      });

      const result = calculatePrice(model, routeFacts);

      // 2500 * 1.2 + 200 + 400 = 3600 > 2700
      expect(result.lineItems.minimumAdjustment).toBeNull();
      expect(result.finalPrice).toBe(3600);
    });

    it('adds Fréjus tunnel surcharge on top of UK surcharge', () => {
      const model = SOLO_MODELS.find((m) => m.id === 'solo-it-uk')!;
      const routeFacts = createTestRouteFacts({
        distanceKm: 2000,
        originCountry: 'ITA',
        destinationCountry: 'GB',
        isUK: true,
        crossesAlps: true,
        hasTunnel: true,
        tunnels: [{ name: 'Fréjus Tunnel', category: 'alpine', country: 'FRA/ITA' }],
      });

      const result = calculatePrice(model, routeFacts);

      // 2000 * 1.2 + 200 + 400 (UK) + 200 (tunnel) = 3200
      expect(result.lineItems.surcharges).toHaveLength(2);
      expect(result.lineItems.surcharges.some((s) => s.type === 'ukFerry')).toBe(true);
      expect(result.lineItems.surcharges.some((s) => s.type === 'alpsTunnel')).toBe(true);
      expect(result.finalPrice).toBe(3200);
    });

    it('calculates quote for Verona->London route', () => {
      const routeFacts = createTestRouteFacts({
        distanceKm: 1400, // Approximate Verona to London
        originCountry: 'IT',
        destinationCountry: 'GB',
        isUK: true,
      });

      const result = calculateQuote('solo_18t_23ep', routeFacts);

      expect(result.modelId).toBe('solo-it-uk');
      expect(result.modelName).toBe('SOLO IT -> UK');
      // 1400 * 1.2 + 200 + 400 = 2280 < 2700 min
      expect(result.finalPrice).toBe(2700);
      expect(result.currency).toBe('EUR');
    });
  });

  describe('calculateQuote', () => {
    it('calculates quote for valid route', () => {
      const routeFacts = createTestRouteFacts({
        distanceKm: 600,
        originCountry: 'POL',
        destinationCountry: 'DEU',
      });

      const result = calculateQuote('solo_18t_23ep', routeFacts);

      expect(result.modelId).toBe('solo-pl-eu');
      expect(result.finalPrice).toBe(800); // (600 + 200) * 1.0
      expect(result.currency).toBe('EUR');
    });

    it('throws error for unsupported lane', () => {
      const routeFacts = createTestRouteFacts({
        originCountry: 'ESP',
        destinationCountry: 'PRT',
      });

      expect(() => calculateQuote('solo_18t_23ep', routeFacts)).toThrow(
        /No pricing model found/
      );
    });

    it('includes model name in result', () => {
      const routeFacts = createTestRouteFacts({
        originCountry: 'ITA',
        destinationCountry: 'FRA',
      });

      const result = calculateQuote('solo_18t_23ep', routeFacts);

      expect(result.modelName).toBe('SOLO IT -> EU');
    });

    it('includes distance in result', () => {
      const routeFacts = createTestRouteFacts({
        distanceKm: 750,
        originCountry: 'POL',
        destinationCountry: 'DEU',
      });

      const result = calculateQuote('solo_18t_23ep', routeFacts);

      expect(result.distanceKm).toBe(750);
    });
  });

  describe('GB/UK normalization', () => {
    it('applies UK surcharge when destinationCountry is GB (alpha-2)', () => {
      const model = SOLO_MODELS.find((m) => m.id === 'solo-pl-eu')!;
      const routeFacts = createTestRouteFacts({
        distanceKm: 800,
        originCountry: 'POL',
        destinationCountry: 'GB', // alpha-2 for UK
        isUK: true,
      });

      const result = calculatePrice(model, routeFacts);

      expect(result.lineItems.surcharges).toHaveLength(1);
      expect(result.lineItems.surcharges[0].type).toBe('ukFerry');
      expect(result.finalPrice).toBe(1400); // (800 + 200) * 1.0 + 400
    });

    it('applies UK surcharge when destinationCountry is UK (variant)', () => {
      const model = SOLO_MODELS.find((m) => m.id === 'solo-pl-eu')!;
      const routeFacts = createTestRouteFacts({
        distanceKm: 800,
        originCountry: 'POL',
        destinationCountry: 'UK', // UK variant (non-ISO but common)
        isUK: true,
      });

      const result = calculatePrice(model, routeFacts);

      expect(result.lineItems.surcharges).toHaveLength(1);
      expect(result.lineItems.surcharges[0].type).toBe('ukFerry');
      expect(result.finalPrice).toBe(1400);
    });

    it('applies UK surcharge when GBR is in countriesCrossed', () => {
      const model = SOLO_MODELS.find((m) => m.id === 'solo-pl-eu')!;
      const routeFacts = createTestRouteFacts({
        distanceKm: 800,
        originCountry: 'POL',
        destinationCountry: 'IRL', // Ireland
        countriesCrossed: ['POL', 'DEU', 'FRA', 'GBR', 'IRL'],
        isUK: false, // Not set via riskFlags but should detect via countries
      });

      // isUKRoute checks countries crossed
      const result = calculatePrice(model, routeFacts);

      expect(result.lineItems.surcharges).toHaveLength(1);
      expect(result.lineItems.surcharges[0].type).toBe('ukFerry');
    });

    it('applies UK surcharge when GB is in countriesCrossed', () => {
      const model = SOLO_MODELS.find((m) => m.id === 'solo-pl-eu')!;
      const routeFacts = createTestRouteFacts({
        distanceKm: 800,
        originCountry: 'POL',
        destinationCountry: 'IRL',
        countriesCrossed: ['POL', 'DEU', 'FRA', 'GB', 'IRL'],
        isUK: false,
      });

      const result = calculatePrice(model, routeFacts);

      expect(result.lineItems.surcharges).toHaveLength(1);
      expect(result.lineItems.surcharges[0].type).toBe('ukFerry');
    });

    it('applies UK minimum 2700 for IT->GB route', () => {
      const model = SOLO_MODELS.find((m) => m.id === 'solo-it-eu')!;
      const routeFacts = createTestRouteFacts({
        distanceKm: 1000,
        originCountry: 'ITA',
        destinationCountry: 'GB', // alpha-2
        isUK: true,
      });

      const result = calculatePrice(model, routeFacts);

      // 1000 * 1.2 + 200 + 400 = 1800 < 2700 UK min
      expect(result.finalPrice).toBe(2700);
    });

    it('applies UK minimum 2700 for IT->UK route (variant)', () => {
      const model = SOLO_MODELS.find((m) => m.id === 'solo-it-eu')!;
      const routeFacts = createTestRouteFacts({
        distanceKm: 1000,
        originCountry: 'ITA',
        destinationCountry: 'UK', // UK variant
        isUK: true,
      });

      const result = calculatePrice(model, routeFacts);

      expect(result.finalPrice).toBe(2700);
    });

    it('detects UK via riskFlags.isUK even without UK in destination', () => {
      const model = SOLO_MODELS.find((m) => m.id === 'solo-pl-eu')!;
      const routeFacts = createTestRouteFacts({
        distanceKm: 800,
        originCountry: 'POL',
        destinationCountry: 'FRA', // Not UK
        isUK: true, // But riskFlags says UK route (e.g., transit)
      });

      const result = calculatePrice(model, routeFacts);

      expect(result.lineItems.surcharges).toHaveLength(1);
      expect(result.lineItems.surcharges[0].type).toBe('ukFerry');
    });
  });

  describe('Alps tunnel surcharge (crossesAlps flag)', () => {
    it('applies Alps surcharge when crossesAlps=true and Fréjus tunnel detected', () => {
      const model = SOLO_MODELS.find((m) => m.id === 'solo-it-eu')!;
      const routeFacts = createTestRouteFacts({
        distanceKm: 800,
        originCountry: 'ITA',
        destinationCountry: 'FRA',
        crossesAlps: true,
        hasTunnel: true,
        tunnels: [{ name: 'Fréjus Tunnel', category: 'alpine', country: 'FRA/ITA' }],
      });

      const result = calculatePrice(model, routeFacts);

      expect(result.lineItems.surcharges).toHaveLength(1);
      expect(result.lineItems.surcharges[0].type).toBe('alpsTunnel');
      expect(result.lineItems.surcharges[0].amount).toBe(200);
    });

    it('applies Alps surcharge when crossesAlps=true and Mont Blanc tunnel detected', () => {
      const model = SOLO_MODELS.find((m) => m.id === 'solo-it-eu')!;
      const routeFacts = createTestRouteFacts({
        distanceKm: 600,
        originCountry: 'ITA',
        destinationCountry: 'FRA',
        crossesAlps: true,
        hasTunnel: true,
        tunnels: [{ name: 'Mont Blanc Tunnel', category: 'alpine', country: 'FRA/ITA' }],
      });

      const result = calculatePrice(model, routeFacts);

      expect(result.lineItems.surcharges.some((s) => s.type === 'alpsTunnel')).toBe(true);
    });

    it('does NOT apply Alps surcharge when crossesAlps=false (no alpine tunnel)', () => {
      const model = SOLO_MODELS.find((m) => m.id === 'solo-it-eu')!;
      const routeFacts = createTestRouteFacts({
        distanceKm: 800,
        originCountry: 'ITA',
        destinationCountry: 'DEU',
        crossesAlps: false,
        hasTunnel: false,
        tunnels: [],
      });

      const result = calculatePrice(model, routeFacts);

      expect(result.lineItems.surcharges.some((s) => s.type === 'alpsTunnel')).toBe(false);
    });

    it('does NOT apply Alps surcharge when crossesAlps=true but no Fréjus/Mont Blanc', () => {
      const model = SOLO_MODELS.find((m) => m.id === 'solo-it-eu')!;
      const routeFacts = createTestRouteFacts({
        distanceKm: 800,
        originCountry: 'ITA',
        destinationCountry: 'AUT',
        crossesAlps: true, // Route crosses Alps (Austria)
        hasTunnel: true,
        tunnels: [{ name: 'Brenner Tunnel', category: 'alpine', country: 'AUT/ITA' }], // Not Fréjus/Mont Blanc
      });

      const result = calculatePrice(model, routeFacts);

      // Alps surcharge should NOT apply - it's specifically for Fréjus/Mont Blanc
      expect(result.lineItems.surcharges.some((s) => s.type === 'alpsTunnel')).toBe(false);
    });

    it('applies Alps surcharge for IT->UK route with Fréjus', () => {
      const model = SOLO_MODELS.find((m) => m.id === 'solo-it-uk')!;
      const routeFacts = createTestRouteFacts({
        distanceKm: 1500,
        originCountry: 'ITA',
        destinationCountry: 'GB',
        isUK: true,
        crossesAlps: true,
        hasTunnel: true,
        tunnels: [{ name: 'Fréjus Tunnel', category: 'alpine', country: 'FRA/ITA' }],
      });

      const result = calculatePrice(model, routeFacts);

      // Should have both UK crossing and Alps tunnel surcharges
      expect(result.lineItems.surcharges).toHaveLength(2);
      expect(result.lineItems.surcharges.some((s) => s.type === 'ukFerry')).toBe(true);
      expect(result.lineItems.surcharges.some((s) => s.type === 'alpsTunnel')).toBe(true);
    });

    it('applies surcharge for Monte Bianco (Italian name for Mont Blanc)', () => {
      const model = SOLO_MODELS.find((m) => m.id === 'solo-it-eu')!;
      const routeFacts = createTestRouteFacts({
        distanceKm: 600,
        originCountry: 'ITA',
        destinationCountry: 'FRA',
        crossesAlps: true,
        hasTunnel: true,
        tunnels: [{ name: 'Traforo del Monte Bianco', category: 'alpine', country: 'FRA/ITA' }],
      });

      const result = calculatePrice(model, routeFacts);

      expect(result.lineItems.surcharges.some((s) => s.type === 'alpsTunnel')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles zero distance', () => {
      const model = SOLO_MODELS.find((m) => m.id === 'solo-pl-eu')!;
      const routeFacts = createTestRouteFacts({
        distanceKm: 0,
        originCountry: 'POL',
        destinationCountry: 'DEU',
      });

      const result = calculatePrice(model, routeFacts);

      // (0 + 200) * 1.0 = 200
      expect(result.lineItems.kmCharge).toBe(0);
      expect(result.lineItems.emptiesCharge).toBe(200);
      expect(result.finalPrice).toBe(200);
    });

    it('handles very long distance', () => {
      const model = SOLO_MODELS.find((m) => m.id === 'solo-it-eu')!;
      const routeFacts = createTestRouteFacts({
        distanceKm: 5000,
        originCountry: 'ITA',
        destinationCountry: 'DEU',
      });

      const result = calculatePrice(model, routeFacts);

      // 5000 * 1.2 + 200 = 6200
      expect(result.finalPrice).toBe(6200);
    });

    it('rounds prices to 2 decimal places', () => {
      const model = SOLO_MODELS.find((m) => m.id === 'solo-it-eu')!;
      const routeFacts = createTestRouteFacts({
        distanceKm: 333, // Will produce non-round numbers
        originCountry: 'ITA',
        destinationCountry: 'DEU',
      });

      const result = calculatePrice(model, routeFacts);

      // 333 * 1.2 = 399.6
      expect(result.lineItems.kmCharge).toBe(399.6);
      expect(Number.isInteger(result.finalPrice * 100)).toBe(true);
    });
  });
});
