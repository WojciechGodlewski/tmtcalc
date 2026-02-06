/**
 * Pricing types and interfaces for market-based pricing
 */

import type { VehicleProfileId } from '../here/vehicle-profiles.js';

/**
 * Country groups for lane matching
 */
export type CountryGroup = 'PL' | 'IT' | 'DE' | 'FR' | 'EU' | 'UK' | 'SCANDI' | 'BALTIC' | 'ANY';

/**
 * Lane definition for origin/destination matching
 */
export interface Lane {
  origin: CountryGroup;
  destination: CountryGroup;
}

/**
 * Surcharge types
 */
export type SurchargeType =
  | 'ukFerry'
  | 'frejusOrMontBlanc'
  | 'alpineTunnel'
  | 'weekend'
  | 'unloadingAfter14'
  | 'custom';

/**
 * Surcharge configuration
 */
export interface SurchargeConfig {
  type: SurchargeType;
  amount: number;
  description: string;
}

/**
 * Market model configuration for a specific lane and vehicle
 */
export interface MarketModel {
  id: string;
  name: string;
  vehicleProfileId: VehicleProfileId;
  lane: Lane;
  /** Rate per kilometer */
  perKmRate: number;
  /** Fixed empty kilometers to add (e.g., 200 for repositioning) */
  emptyKmFlat?: number;
  /** Fixed empty fee (alternative to emptyKmFlat) */
  emptyFeeFlat?: number;
  /** Default minimum price */
  defaultMin?: number;
  /** Minimum price for UK routes */
  ukMin?: number;
  /** Available surcharges for this model */
  surcharges?: SurchargeConfig[];
}

/**
 * Surcharge line item in pricing result
 */
export interface SurchargeLineItem {
  type: SurchargeType;
  description: string;
  amount: number;
}

/**
 * Pricing result with explainable line items
 */
export interface PricingResult {
  /** Model used for pricing */
  modelId: string;
  modelName: string;
  /** Distance used for calculation */
  distanceKm: number;
  /** Line items breakdown */
  lineItems: {
    /** Base km charge */
    kmCharge: number;
    /** Empty km or fee charge */
    emptiesCharge: number;
    /** Applied surcharges */
    surcharges: SurchargeLineItem[];
    /** Minimum adjustment if applied (positive means price was raised) */
    minimumAdjustment: number | null;
  };
  /** Final calculated price */
  finalPrice: number;
  /** Currency */
  currency: string;
}

/**
 * Quote request options
 */
export interface QuoteOptions {
  /** ISO datetime for pricing context */
  pricingDateTime?: string;
  /** Whether unloading is after 14:00 */
  unloadingAfter14?: boolean;
  /** Whether it's a weekend delivery */
  isWeekend?: boolean;
}

/**
 * Country code to group mapping
 */
export const COUNTRY_GROUP_MAP: Record<string, CountryGroup> = {
  // Poland
  PL: 'PL',
  POL: 'PL',

  // Italy
  IT: 'IT',
  ITA: 'IT',

  // Germany
  DE: 'DE',
  DEU: 'DE',

  // France
  FR: 'FR',
  FRA: 'FR',

  // UK
  GB: 'UK',
  GBR: 'UK',
  UK: 'UK',

  // Scandinavia
  SE: 'SCANDI',
  SWE: 'SCANDI',
  NO: 'SCANDI',
  NOR: 'SCANDI',
  DK: 'SCANDI',
  DNK: 'SCANDI',
  FI: 'SCANDI',
  FIN: 'SCANDI',

  // Baltic
  LT: 'BALTIC',
  LTU: 'BALTIC',
  LV: 'BALTIC',
  LVA: 'BALTIC',
  EE: 'BALTIC',
  EST: 'BALTIC',
};

/**
 * EU country codes (for EU group matching)
 */
export const EU_COUNTRIES = new Set([
  'AT', 'AUT', // Austria
  'BE', 'BEL', // Belgium
  'BG', 'BGR', // Bulgaria
  'HR', 'HRV', // Croatia
  'CY', 'CYP', // Cyprus
  'CZ', 'CZE', // Czech Republic
  'DK', 'DNK', // Denmark
  'EE', 'EST', // Estonia
  'FI', 'FIN', // Finland
  'FR', 'FRA', // France
  'DE', 'DEU', // Germany
  'GR', 'GRC', // Greece
  'HU', 'HUN', // Hungary
  'IE', 'IRL', // Ireland
  'IT', 'ITA', // Italy
  'LV', 'LVA', // Latvia
  'LT', 'LTU', // Lithuania
  'LU', 'LUX', // Luxembourg
  'MT', 'MLT', // Malta
  'NL', 'NLD', // Netherlands
  'PL', 'POL', // Poland
  'PT', 'PRT', // Portugal
  'RO', 'ROU', // Romania
  'SK', 'SVK', // Slovakia
  'SI', 'SVN', // Slovenia
  'ES', 'ESP', // Spain
  'SE', 'SWE', // Sweden
]);

/**
 * Get country group for a country code
 */
export function getCountryGroup(countryCode: string | null): CountryGroup | null {
  if (!countryCode) return null;

  const normalized = countryCode.toUpperCase();

  // Check specific group first
  if (COUNTRY_GROUP_MAP[normalized]) {
    return COUNTRY_GROUP_MAP[normalized];
  }

  // Check if EU
  if (EU_COUNTRIES.has(normalized)) {
    return 'EU';
  }

  return null;
}

/**
 * Check if a country matches a group
 */
export function countryMatchesGroup(countryCode: string | null, group: CountryGroup): boolean {
  if (!countryCode) return group === 'ANY';
  if (group === 'ANY') return true;

  const normalized = countryCode.toUpperCase();
  const countryGroup = getCountryGroup(countryCode);

  // Direct match
  if (countryGroup === group) return true;

  // EU includes all EU countries
  if (group === 'EU' && EU_COUNTRIES.has(normalized)) return true;

  return false;
}
