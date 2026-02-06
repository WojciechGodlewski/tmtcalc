/**
 * Market-based pricing engine
 */

import type { RouteFacts } from '../types/route-facts.js';
import type { VehicleProfileId } from '../here/vehicle-profiles.js';
import {
  type MarketModel,
  type PricingResult,
  type SurchargeLineItem,
  type QuoteOptions,
  countryMatchesGroup,
  getCountryGroup,
} from './types.js';
import { getModelsForVehicle } from './market-models.js';

/**
 * Check if route goes to/through UK
 */
function isUKRoute(routeFacts: RouteFacts): boolean {
  // Check risk flags
  if (routeFacts.riskFlags.isUK) return true;

  // Check destination country
  const dest = routeFacts.geography.destinationCountry?.toUpperCase();
  if (dest === 'GB' || dest === 'GBR' || dest === 'UK') return true;

  // Check countries crossed
  for (const country of routeFacts.geography.countriesCrossed) {
    const normalized = country.toUpperCase();
    if (normalized === 'GB' || normalized === 'GBR' || normalized === 'UK') return true;
  }

  return false;
}

/**
 * Check if route uses Fréjus or Mont Blanc tunnel
 * Checks both the crossesAlps risk flag and tunnel names for robustness
 */
function hasFrejusOrMontBlanc(routeFacts: RouteFacts): boolean {
  // First check if any alpine tunnel is detected via riskFlags
  // This is set by the extractor when Fréjus/Mont Blanc is detected
  if (!routeFacts.infrastructure.hasTunnel) return false;

  // Check for specific Fréjus/Mont Blanc tunnels by name
  for (const tunnel of routeFacts.infrastructure.tunnels) {
    if (!tunnel.name) continue;
    // Normalize: lowercase and remove diacritics
    const name = tunnel.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (
      name.includes('frejus') ||
      name.includes('mont blanc') ||
      name.includes('mont-blanc') ||
      name.includes('montblanc') ||
      name.includes('monte bianco')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Check if route uses any alpine tunnel
 */
function hasAlpineTunnel(routeFacts: RouteFacts): boolean {
  if (!routeFacts.infrastructure.hasTunnel) return false;

  for (const tunnel of routeFacts.infrastructure.tunnels) {
    if (tunnel.category === 'alpine') return true;
  }

  return false;
}

/**
 * Find matching market model for route
 */
export function findMatchingModel(
  vehicleProfileId: VehicleProfileId,
  routeFacts: RouteFacts
): MarketModel | null {
  const models = getModelsForVehicle(vehicleProfileId);
  const originCountry = routeFacts.geography.originCountry;
  const destCountry = routeFacts.geography.destinationCountry;

  // Find first matching model (order matters - more specific first)
  for (const model of models) {
    const originMatch = countryMatchesGroup(originCountry, model.lane.origin);
    const destMatch = countryMatchesGroup(destCountry, model.lane.destination);

    if (originMatch && destMatch) {
      return model;
    }
  }

  return null;
}

/**
 * Calculate price using market model
 */
export function calculatePrice(
  model: MarketModel,
  routeFacts: RouteFacts,
  _options: QuoteOptions = {}
): PricingResult {
  const distanceKm = routeFacts.route.distanceKm;
  const surcharges: SurchargeLineItem[] = [];

  // Calculate base km charge
  let kmCharge: number;
  let emptiesCharge: number;

  if (model.emptyKmFlat !== undefined) {
    // Add empty km to distance and multiply by rate
    // Formula: (routeKm + emptyKm) * rate
    const totalKm = distanceKm + model.emptyKmFlat;
    kmCharge = distanceKm * model.perKmRate;
    emptiesCharge = model.emptyKmFlat * model.perKmRate;
  } else if (model.emptyFeeFlat !== undefined) {
    // Use flat empty fee
    // Formula: (routeKm * rate) + emptyFee
    kmCharge = distanceKm * model.perKmRate;
    emptiesCharge = model.emptyFeeFlat;
  } else {
    // No empties
    kmCharge = distanceKm * model.perKmRate;
    emptiesCharge = 0;
  }

  // Check for applicable surcharges
  const isUK = isUKRoute(routeFacts);
  const hasFrejusMontBlanc = hasFrejusOrMontBlanc(routeFacts);
  const hasAlpine = hasAlpineTunnel(routeFacts);
  const crossesAlps = routeFacts.riskFlags.crossesAlps && hasFrejusMontBlanc;

  if (model.surcharges) {
    for (const surchargeConfig of model.surcharges) {
      let applies = false;

      switch (surchargeConfig.type) {
        case 'ukFerry':
          applies = isUK;
          break;
        case 'frejusOrMontBlanc':
          applies = hasFrejusMontBlanc;
          break;
        case 'alpsTunnel':
          // Triggered when crossesAlps is true AND Fréjus/Mont Blanc is detected
          applies = crossesAlps;
          break;
        case 'alpineTunnel':
          applies = hasAlpine;
          break;
        // TODO: Handle weekend and unloadingAfter14 based on options
        case 'weekend':
          // applies = options.isWeekend ?? false;
          break;
        case 'unloadingAfter14':
          // applies = options.unloadingAfter14 ?? false;
          break;
      }

      if (applies) {
        surcharges.push({
          type: surchargeConfig.type,
          description: surchargeConfig.description,
          amount: surchargeConfig.amount,
        });
      }
    }
  }

  // Calculate subtotal
  const surchargesTotal = surcharges.reduce((sum, s) => sum + s.amount, 0);
  let subtotal = kmCharge + emptiesCharge + surchargesTotal;

  // Apply minimum
  let minimumAdjustment: number | null = null;
  let minimum: number | undefined;

  if (isUK && model.ukMin !== undefined) {
    minimum = model.ukMin;
  } else if (model.defaultMin !== undefined) {
    minimum = model.defaultMin;
  }

  if (minimum !== undefined && subtotal < minimum) {
    minimumAdjustment = minimum - subtotal;
    subtotal = minimum;
  }

  // Round to 2 decimal places
  const finalPrice = Math.round(subtotal * 100) / 100;

  return {
    modelId: model.id,
    modelName: model.name,
    distanceKm,
    lineItems: {
      kmCharge: Math.round(kmCharge * 100) / 100,
      emptiesCharge: Math.round(emptiesCharge * 100) / 100,
      surcharges,
      minimumAdjustment: minimumAdjustment !== null
        ? Math.round(minimumAdjustment * 100) / 100
        : null,
    },
    finalPrice,
    currency: 'EUR',
  };
}

/**
 * Calculate quote for a route
 * @throws Error if no matching model found
 */
export function calculateQuote(
  vehicleProfileId: VehicleProfileId,
  routeFacts: RouteFacts,
  options: QuoteOptions = {}
): PricingResult {
  const model = findMatchingModel(vehicleProfileId, routeFacts);

  if (!model) {
    const origin = routeFacts.geography.originCountry ?? 'unknown';
    const dest = routeFacts.geography.destinationCountry ?? 'unknown';
    const originGroup = getCountryGroup(origin);
    const destGroup = getCountryGroup(dest);

    throw new Error(
      `No pricing model found for vehicle ${vehicleProfileId} ` +
      `from ${origin}${originGroup ? ` (group: ${originGroup})` : ''} ` +
      `to ${dest}${destGroup ? ` (group: ${destGroup})` : ''}`
    );
  }

  return calculatePrice(model, routeFacts, options);
}
