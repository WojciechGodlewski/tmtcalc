/**
 * Market model configurations
 * Config-driven pricing rules for different lanes and vehicles
 */

import type { MarketModel } from './types.js';

/**
 * Market models for SOLO truck (solo_18t_23ep)
 * Note: Order matters - more specific models should come first
 */
export const SOLO_MODELS: MarketModel[] = [
  {
    id: 'solo-pl-eu',
    name: 'SOLO PL -> EU',
    vehicleProfileId: 'solo_18t_23ep',
    lane: {
      origin: 'PL',
      destination: 'EU',
    },
    perKmRate: 1.0,
    emptyKmFlat: 200,
    surcharges: [
      {
        type: 'ukFerry',
        amount: 400,
        description: 'UK ferry surcharge',
      },
    ],
  },
  // IT -> UK must come before IT -> EU (more specific first)
  {
    id: 'solo-it-uk',
    name: 'SOLO IT -> UK',
    vehicleProfileId: 'solo_18t_23ep',
    lane: {
      origin: 'IT',
      destination: 'UK',
    },
    perKmRate: 1.2,
    emptyFeeFlat: 200,
    defaultMin: 2700,
    surcharges: [
      {
        type: 'ukFerry',
        amount: 400,
        description: 'UK crossing surcharge',
      },
      {
        type: 'alpsTunnel',
        amount: 200,
        description: 'Fréjus/Mont Blanc tunnel surcharge',
      },
    ],
  },
  {
    id: 'solo-it-eu',
    name: 'SOLO IT -> EU',
    vehicleProfileId: 'solo_18t_23ep',
    lane: {
      origin: 'IT',
      destination: 'EU',
    },
    perKmRate: 1.2,
    emptyFeeFlat: 200,
    defaultMin: 1200,
    ukMin: 2700,
    surcharges: [
      {
        type: 'ukFerry',
        amount: 400,
        description: 'UK ferry surcharge',
      },
      {
        type: 'alpsTunnel',
        amount: 200,
        description: 'Fréjus/Mont Blanc tunnel surcharge',
      },
    ],
  },
];

/**
 * Market models for VAN (van_8ep)
 */
export const VAN_MODELS: MarketModel[] = [
  {
    id: 'van-eu-eu',
    name: 'VAN EU -> EU',
    vehicleProfileId: 'van_8ep',
    lane: {
      origin: 'EU',
      destination: 'EU',
    },
    perKmRate: 0.8,
    emptyKmFlat: 100,
    defaultMin: 500,
    surcharges: [
      {
        type: 'ukFerry',
        amount: 250,
        description: 'UK ferry surcharge',
      },
    ],
  },
];

/**
 * Market models for FTL (ftl_13_6_33ep)
 */
export const FTL_MODELS: MarketModel[] = [
  {
    id: 'ftl-pl-eu',
    name: 'FTL PL -> EU',
    vehicleProfileId: 'ftl_13_6_33ep',
    lane: {
      origin: 'PL',
      destination: 'EU',
    },
    perKmRate: 1.3,
    emptyKmFlat: 250,
    defaultMin: 1500,
    surcharges: [
      {
        type: 'ukFerry',
        amount: 500,
        description: 'UK ferry surcharge',
      },
      {
        type: 'frejusOrMontBlanc',
        amount: 300,
        description: 'Fréjus/Mont Blanc tunnel surcharge',
      },
    ],
  },
  {
    id: 'ftl-it-eu',
    name: 'FTL IT -> EU',
    vehicleProfileId: 'ftl_13_6_33ep',
    lane: {
      origin: 'IT',
      destination: 'EU',
    },
    perKmRate: 1.4,
    emptyFeeFlat: 300,
    defaultMin: 1800,
    ukMin: 3500,
    surcharges: [
      {
        type: 'ukFerry',
        amount: 500,
        description: 'UK ferry surcharge',
      },
      {
        type: 'frejusOrMontBlanc',
        amount: 300,
        description: 'Fréjus/Mont Blanc tunnel surcharge',
      },
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
