import { describe, it, expect } from 'vitest';
import {
  findMatchingModel,
  calculatePrice,
  calculateQuote,
} from './engine.js';
import { SOLO_MODELS, VAN_MODELS, FTL_MODELS } from './market-models.js';
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
  ukCrossings?: number;
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
      originCountry: overrides.originCountry ?? 'PL',
      destinationCountry: overrides.destinationCountry ?? 'DE',
      countriesCrossed: overrides.countriesCrossed ?? ['PL', 'DE'],
      isInternational: true,
      isEU: true,
      ukCrossings: overrides.ukCrossings ?? (overrides.isUK ? 1 : 0),
    },
    infrastructure: {
      hasFerry: false,
      ferrySegments: 0,
      crossings: [],
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

describe('Pricing Engine (agreed rate card)', () => {
  describe('findMatchingModel: two lanes per vehicle', () => {
    it('PL origin gets the discounted PL lane', () => {
      const model = findMatchingModel('solo_18t_23ep', createTestRouteFacts({
        originCountry: 'PL', destinationCountry: 'DE',
      }));
      expect(model?.id).toBe('solo-pl-europe');
    });

    it('non-PL European origins get the catch-all lane (IT, DE, ES, CH)', () => {
      for (const origin of ['IT', 'DE', 'ES', 'CH']) {
        const model = findMatchingModel('solo_18t_23ep', createTestRouteFacts({
          originCountry: origin, destinationCountry: 'FR',
        }));
        expect(model?.id).toBe('solo-europe');
      }
    });

    it('UK is an allowed origin at the catch-all rate', () => {
      const model = findMatchingModel('solo_18t_23ep', createTestRouteFacts({
        originCountry: 'GB', destinationCountry: 'DE',
      }));
      expect(model?.id).toBe('solo-europe');
    });

    it('previously uncovered lanes now price (ES -> PT, FR -> FR domestic)', () => {
      expect(findMatchingModel('solo_18t_23ep', createTestRouteFacts({
        originCountry: 'ES', destinationCountry: 'PT',
      }))?.id).toBe('solo-europe');
      expect(findMatchingModel('solo_18t_23ep', createTestRouteFacts({
        originCountry: 'FR', destinationCountry: 'FR',
      }))?.id).toBe('solo-europe');
    });

    it('accepts alpha-3 codes too', () => {
      expect(findMatchingModel('solo_18t_23ep', createTestRouteFacts({
        originCountry: 'POL', destinationCountry: 'DEU',
      }))?.id).toBe('solo-pl-europe');
      expect(findMatchingModel('solo_18t_23ep', createTestRouteFacts({
        originCountry: 'ITA', destinationCountry: 'GBR',
      }))?.id).toBe('solo-europe');
    });

    it('returns null outside the EUROPE group (UA/TR excluded by design)', () => {
      expect(findMatchingModel('solo_18t_23ep', createTestRouteFacts({
        originCountry: 'UA', destinationCountry: 'PL',
      }))).toBeNull();
      expect(findMatchingModel('solo_18t_23ep', createTestRouteFacts({
        originCountry: 'PL', destinationCountry: 'TR',
      }))).toBeNull();
    });

    it('selects van and FTL lanes analogously', () => {
      expect(findMatchingModel('van_8ep', createTestRouteFacts({ originCountry: 'PL' }))?.id).toBe('van-pl-europe');
      expect(findMatchingModel('van_8ep', createTestRouteFacts({ originCountry: 'NL' }))?.id).toBe('van-europe');
      expect(findMatchingModel('ftl_13_6_33ep', createTestRouteFacts({ originCountry: 'PL' }))?.id).toBe('ftl-pl-europe');
      expect(findMatchingModel('ftl_13_6_33ep', createTestRouteFacts({ originCountry: 'RO' }))?.id).toBe('ftl-europe');
    });

    it('returns null for unknown vehicle profile', () => {
      expect(findMatchingModel('unknown_profile' as never, createTestRouteFacts({}))).toBeNull();
    });
  });

  describe('SOLO PL -> Europe (1.0/km, 200 rated empty km, min 900, ukMin 2400)', () => {
    const model = SOLO_MODELS.find((m) => m.id === 'solo-pl-europe')!;

    it('calculates (routeKm + 200) * 1.0', () => {
      const result = calculatePrice(model, createTestRouteFacts({ distanceKm: 1100 }));
      expect(result.lineItems.kmCharge).toBe(1100);
      expect(result.lineItems.emptiesCharge).toBe(200); // 200 km * 1.0
      expect(result.finalPrice).toBe(1300);
    });

    it('applies the 900 minimum on short routes', () => {
      const result = calculatePrice(model, createTestRouteFacts({ distanceKm: 300 }));
      // 300 + 200 = 500 -> min 900
      expect(result.lineItems.minimumAdjustment).toBe(400);
      expect(result.finalPrice).toBe(900);
    });

    it('UK destination: +400 surcharge and ukMin 2400', () => {
      const result = calculatePrice(model, createTestRouteFacts({
        distanceKm: 1500, destinationCountry: 'GB', countriesCrossed: ['PL', 'DE', 'FR', 'GB'], isUK: true,
      }));
      // 1500 + 200 + 400 = 2100 < ukMin 2400
      expect(result.lineItems.surcharges).toEqual([
        { type: 'ukFerry', amount: 400, description: 'UK crossing surcharge' },
      ]);
      expect(result.lineItems.minimumAdjustment).toBe(300);
      expect(result.finalPrice).toBe(2400);
    });

    it('no minimum adjustment when above ukMin', () => {
      const result = calculatePrice(model, createTestRouteFacts({
        distanceKm: 3000, destinationCountry: 'GB', isUK: true,
      }));
      // 3000 + 200 + 400 = 3600 > 2400
      expect(result.lineItems.minimumAdjustment).toBeNull();
      expect(result.finalPrice).toBe(3600);
    });
  });

  describe('SOLO Europe -> Europe (1.2/km, 200 rated empty km = 240, min 1200, ukMin 2700)', () => {
    const model = SOLO_MODELS.find((m) => m.id === 'solo-europe')!;

    it('calculates km * 1.2 with rated empties of 240', () => {
      const result = calculatePrice(model, createTestRouteFacts({
        distanceKm: 1000, originCountry: 'IT', destinationCountry: 'DE',
      }));
      expect(result.lineItems.kmCharge).toBe(1200);
      expect(result.lineItems.emptiesCharge).toBe(240); // 200 km * 1.2 - rated, not flat
      expect(result.finalPrice).toBe(1440);
    });

    it('applies the 1200 minimum (Verona -> Munich case)', () => {
      const result = calculatePrice(model, createTestRouteFacts({
        distanceKm: 430, originCountry: 'IT', destinationCountry: 'DE',
      }));
      // 516 + 240 = 756 -> min 1200
      expect(result.lineItems.minimumAdjustment).toBe(444);
      expect(result.finalPrice).toBe(1200);
    });

    it('IT -> UK: +400 and ukMin 2700 (Verona -> London case)', () => {
      const result = calculatePrice(model, createTestRouteFacts({
        distanceKm: 1600, originCountry: 'IT', destinationCountry: 'GB', isUK: true,
      }));
      // 1920 + 240 + 400 = 2560 -> ukMin 2700
      expect(result.lineItems.minimumAdjustment).toBeCloseTo(140, 2);
      expect(result.finalPrice).toBe(2700);
    });

    it('surcharges are direction-agnostic: UK -> IT gets the same +400 and ukMin', () => {
      const result = calculatePrice(model, createTestRouteFacts({
        distanceKm: 1600, originCountry: 'GB', destinationCountry: 'IT',
        countriesCrossed: ['GB', 'FR', 'IT'], isUK: true,
      }));
      expect(result.lineItems.surcharges.some((s) => s.type === 'ukFerry')).toBe(true);
      expect(result.finalPrice).toBe(2700);
    });

    it('UK surcharge is per crossing: round trip (ukCrossings 2) pays 2 x 400', () => {
      const result = calculatePrice(model, createTestRouteFacts({
        distanceKm: 3300, originCountry: 'IT', destinationCountry: 'IT',
        countriesCrossed: ['IT', 'FR', 'GB'], isUK: true, ukCrossings: 2,
      }));
      expect(result.lineItems.surcharges).toEqual([
        {
          type: 'ukFerry',
          amount: 800,
          count: 2,
          unitAmount: 400,
          description: 'UK crossing surcharge × 2 crossings',
        },
      ]);
      // 3960 + 240 + 800 = 5000
      expect(result.finalPrice).toBe(5000);
    });

    it('falls back to a single UK surcharge when isUK is set but ukCrossings is 0', () => {
      // UK transit detected without stop-level transitions (e.g. toll-derived
      // only, or a legacy RouteFacts payload) - never lose the surcharge
      const result = calculatePrice(model, createTestRouteFacts({
        distanceKm: 3000, originCountry: 'IT', destinationCountry: 'GB',
        isUK: true, ukCrossings: 0,
      }));
      const uk = result.lineItems.surcharges.filter((s) => s.type === 'ukFerry');
      expect(uk).toHaveLength(1);
      expect(uk[0].amount).toBe(400);
      expect(uk[0].description).toBe('UK crossing surcharge');
      expect(uk[0].count).toBeUndefined();
    });

    it('adds the Alps surcharge when crossesAlps is set (either direction)', () => {
      const result = calculatePrice(model, createTestRouteFacts({
        distanceKm: 180, originCountry: 'IT', destinationCountry: 'FR',
        crossesAlps: true, hasTunnel: true,
        tunnels: [{ name: 'Fréjus Tunnel', category: 'alpine', country: 'FRA/ITA' }],
      }));
      const alps = result.lineItems.surcharges.find((s) => s.type === 'alpsTunnel');
      expect(alps?.amount).toBe(200);
      // 216 + 240 + 200 = 656 -> min 1200
      expect(result.finalPrice).toBe(1200);
    });

    it('does NOT add the Alps surcharge for other alpine tunnels (e.g. Brenner)', () => {
      const result = calculatePrice(model, createTestRouteFacts({
        distanceKm: 800, originCountry: 'IT', destinationCountry: 'AT',
        crossesAlps: false, hasTunnel: true,
        tunnels: [{ name: 'Brenner Tunnel', category: 'alpine', country: 'AUT/ITA' }],
      }));
      expect(result.lineItems.surcharges.some((s) => s.type === 'alpsTunnel')).toBe(false);
    });

    it('no minimum when the price exceeds it', () => {
      const result = calculatePrice(model, createTestRouteFacts({
        distanceKm: 2000, originCountry: 'IT', destinationCountry: 'ES',
      }));
      // 2400 + 240 = 2640 > 1200
      expect(result.lineItems.minimumAdjustment).toBeNull();
      expect(result.finalPrice).toBe(2640);
    });
  });

  describe('VAN lanes (0.65/0.75 per km, 100 rated empty km)', () => {
    it('PL lane: rated empties 65, min 450', () => {
      const model = VAN_MODELS.find((m) => m.id === 'van-pl-europe')!;
      const result = calculatePrice(model, createTestRouteFacts({ distanceKm: 400 }));
      expect(result.lineItems.kmCharge).toBe(260);
      expect(result.lineItems.emptiesCharge).toBe(65); // 100 km * 0.65
      expect(result.lineItems.minimumAdjustment).toBe(125); // 325 -> 450
      expect(result.finalPrice).toBe(450);
    });

    it('catch-all lane: rated empties 75, Alps +100, ukMin 1000', () => {
      const model = VAN_MODELS.find((m) => m.id === 'van-europe')!;
      const alps = calculatePrice(model, createTestRouteFacts({
        distanceKm: 1000, originCountry: 'IT', destinationCountry: 'FR', crossesAlps: true,
      }));
      expect(alps.lineItems.emptiesCharge).toBe(75); // 100 km * 0.75
      expect(alps.lineItems.surcharges.find((s) => s.type === 'alpsTunnel')?.amount).toBe(100);
      // 750 + 75 + 100 = 925
      expect(alps.finalPrice).toBe(925);

      const uk = calculatePrice(model, createTestRouteFacts({
        distanceKm: 300, originCountry: 'FR', destinationCountry: 'GB', isUK: true,
      }));
      // 225 + 75 + 250 = 550 -> ukMin 1000
      expect(uk.finalPrice).toBe(1000);
    });
  });

  describe('FTL lanes (1.3/1.4 per km, 250 rated empty km, Alps +300)', () => {
    it('PL lane: rated empties 325, min 1500', () => {
      const model = FTL_MODELS.find((m) => m.id === 'ftl-pl-europe')!;
      const result = calculatePrice(model, createTestRouteFacts({ distanceKm: 700 }));
      expect(result.lineItems.kmCharge).toBe(910);
      expect(result.lineItems.emptiesCharge).toBe(325); // 250 km * 1.3
      expect(result.lineItems.minimumAdjustment).toBe(265); // 1235 -> 1500
      expect(result.finalPrice).toBe(1500);
    });

    it('catch-all lane: rated empties 350, UK +500 with ukMin 3500, Alps +300', () => {
      const model = FTL_MODELS.find((m) => m.id === 'ftl-europe')!;
      const uk = calculatePrice(model, createTestRouteFacts({
        distanceKm: 1600, originCountry: 'IT', destinationCountry: 'GB', isUK: true,
      }));
      // 2240 + 350 + 500 = 3090 -> ukMin 3500
      expect(uk.lineItems.minimumAdjustment).toBe(410);
      expect(uk.finalPrice).toBe(3500);

      const alps = calculatePrice(model, createTestRouteFacts({
        distanceKm: 2000, originCountry: 'IT', destinationCountry: 'FR', crossesAlps: true,
      }));
      expect(alps.lineItems.surcharges.find((s) => s.type === 'alpsTunnel')?.amount).toBe(300);
      // 2800 + 350 + 300 = 3450 > 1800
      expect(alps.finalPrice).toBe(3450);
    });
  });

  describe('calculateQuote', () => {
    it('returns a full result with model name for a covered lane', () => {
      const result = calculateQuote('solo_18t_23ep', createTestRouteFacts({
        distanceKm: 1100, originCountry: 'PL', destinationCountry: 'IT',
      }));
      expect(result.modelId).toBe('solo-pl-europe');
      expect(result.modelName).toBe('SOLO PL -> Europe');
      expect(result.finalPrice).toBe(1300);
      expect(result.currency).toBe('EUR');
    });

    it('throws for lanes outside the EUROPE group', () => {
      expect(() => calculateQuote('solo_18t_23ep', createTestRouteFacts({
        originCountry: 'UA', destinationCountry: 'PL',
      }))).toThrowError(/No pricing model found/);
    });

    it('weekend/unloadingAfter14 options are accepted but do not change the price (dead by design)', () => {
      const facts = createTestRouteFacts({ distanceKm: 1000 });
      const base = calculateQuote('solo_18t_23ep', facts);
      const withOptions = calculateQuote('solo_18t_23ep', facts, { isWeekend: true, unloadingAfter14: true });
      expect(withOptions.finalPrice).toBe(base.finalPrice);
      expect(withOptions.lineItems.surcharges).toEqual(base.lineItems.surcharges);
    });
  });
});
