/**
 * Market model configurations - the rate card.
 *
 * Structure: two lanes per vehicle.
 *   - PL -> EUROPE: discounted lane (PL carrier cost base)
 *   - EUROPE -> EUROPE: catch-all for every other European origin,
 *     including domestic routes and UK origins
 *
 * EUROPE = EU27 + UK + EFTA (CH/NO/IS/LI) + Western Balkans
 * (see EUROPE_COUNTRIES in types.ts; UA/BY/RU/TR deliberately excluded).
 *
 * Conventions (agreed rate card):
 * - Empties are RATED: emptyKmFlat km priced at the lane's per-km rate,
 *   so repositioning cost scales with the vehicle type.
 * - Every lane has a defaultMin and a ukMin (UK routes have higher fixed
 *   costs). The minimum is applied after surcharges.
 * - Surcharges are direction-agnostic: UK crossing and Alps tunnel apply
 *   whenever the route touches the UK / Fréjus-Mont Blanc, regardless of
 *   direction (detection is symmetric by construction).
 * - The UK crossing surcharge is PER CROSSING: the configured amount is one
 *   UK entry/exit (ferry or Eurotunnel shuttle alike), so a round trip
 *   EU -> UK -> EU pays it twice (see geography.ukCrossings).
 * - Order matters: the more specific PL lane is listed before the catch-all.
 */

import type { MarketModel } from './types.js';

/**
 * Market models for VAN (van_8ep)
 */
export const VAN_MODELS: MarketModel[] = [
  {
    id: 'van-pl-europe',
    name: 'VAN PL -> Europe',
    vehicleProfileId: 'van_8ep',
    lane: { origin: 'PL', destination: 'EUROPE' },
    perKmRate: 0.65,
    emptyKmFlat: 100,
    defaultMin: 450,
    ukMin: 900,
    surcharges: [
      { type: 'ukFerry', amount: 250, description: 'UK crossing surcharge' },
      { type: 'alpsTunnel', amount: 100, description: 'Fréjus/Mont Blanc tunnel surcharge' },
    ],
  },
  {
    id: 'van-europe',
    name: 'VAN Europe -> Europe',
    vehicleProfileId: 'van_8ep',
    lane: { origin: 'EUROPE', destination: 'EUROPE' },
    perKmRate: 0.75,
    emptyKmFlat: 100,
    defaultMin: 500,
    ukMin: 1000,
    surcharges: [
      { type: 'ukFerry', amount: 250, description: 'UK crossing surcharge' },
      { type: 'alpsTunnel', amount: 100, description: 'Fréjus/Mont Blanc tunnel surcharge' },
    ],
  },
];

/**
 * Market models for SOLO truck (solo_18t_23ep)
 */
export const SOLO_MODELS: MarketModel[] = [
  {
    id: 'solo-pl-europe',
    name: 'SOLO PL -> Europe',
    vehicleProfileId: 'solo_18t_23ep',
    lane: { origin: 'PL', destination: 'EUROPE' },
    perKmRate: 1.0,
    emptyKmFlat: 200,
    defaultMin: 900,
    ukMin: 2400,
    surcharges: [
      { type: 'ukFerry', amount: 400, description: 'UK crossing surcharge' },
      { type: 'alpsTunnel', amount: 200, description: 'Fréjus/Mont Blanc tunnel surcharge' },
    ],
  },
  {
    id: 'solo-europe',
    name: 'SOLO Europe -> Europe',
    vehicleProfileId: 'solo_18t_23ep',
    lane: { origin: 'EUROPE', destination: 'EUROPE' },
    perKmRate: 1.2,
    emptyKmFlat: 200,
    defaultMin: 1200,
    ukMin: 2700,
    surcharges: [
      { type: 'ukFerry', amount: 400, description: 'UK crossing surcharge' },
      { type: 'alpsTunnel', amount: 200, description: 'Fréjus/Mont Blanc tunnel surcharge' },
    ],
  },
];

/**
 * Market models for FTL (ftl_13_6_33ep)
 */
export const FTL_MODELS: MarketModel[] = [
  {
    id: 'ftl-pl-europe',
    name: 'FTL PL -> Europe',
    vehicleProfileId: 'ftl_13_6_33ep',
    lane: { origin: 'PL', destination: 'EUROPE' },
    perKmRate: 1.3,
    emptyKmFlat: 250,
    defaultMin: 1500,
    ukMin: 3200,
    surcharges: [
      { type: 'ukFerry', amount: 500, description: 'UK crossing surcharge' },
      { type: 'alpsTunnel', amount: 300, description: 'Fréjus/Mont Blanc tunnel surcharge' },
    ],
  },
  {
    id: 'ftl-europe',
    name: 'FTL Europe -> Europe',
    vehicleProfileId: 'ftl_13_6_33ep',
    lane: { origin: 'EUROPE', destination: 'EUROPE' },
    perKmRate: 1.4,
    emptyKmFlat: 250,
    defaultMin: 1800,
    ukMin: 3500,
    surcharges: [
      { type: 'ukFerry', amount: 500, description: 'UK crossing surcharge' },
      { type: 'alpsTunnel', amount: 300, description: 'Fréjus/Mont Blanc tunnel surcharge' },
    ],
  },
];

/**
 * All market models
 */
export const ALL_MARKET_MODELS: MarketModel[] = [
  ...SOLO_MODELS,
  ...VAN_MODELS,
  ...FTL_MODELS,
];

/**
 * Get market models for a specific vehicle
 */
export function getModelsForVehicle(vehicleProfileId: string): MarketModel[] {
  return ALL_MARKET_MODELS.filter((m) => m.vehicleProfileId === vehicleProfileId);
}
