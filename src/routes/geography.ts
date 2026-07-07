/**
 * Shared country-code normalization and RouteFacts geography enrichment
 * used by the /api/route-facts and /api/quote handlers.
 *
 * RouteFacts geography is always exposed as ISO 3166-1 alpha-2 (PL, IT, DE, GB).
 * HERE geocoding returns alpha-3 (POL, ITA, DEU, GBR), so codes are converted here.
 */

import type { RouteFacts } from '../types/route-facts.js';

/**
 * ISO 3166-1 alpha-3 to alpha-2 country code mapping
 */
const ALPHA3_TO_ALPHA2: Record<string, string> = {
  // EU member states
  AUT: 'AT', BEL: 'BE', BGR: 'BG', HRV: 'HR', CYP: 'CY',
  CZE: 'CZ', DNK: 'DK', EST: 'EE', FIN: 'FI', FRA: 'FR',
  DEU: 'DE', GRC: 'GR', HUN: 'HU', IRL: 'IE', ITA: 'IT',
  LVA: 'LV', LTU: 'LT', LUX: 'LU', MLT: 'MT', NLD: 'NL',
  POL: 'PL', PRT: 'PT', ROU: 'RO', SVK: 'SK', SVN: 'SI',
  ESP: 'ES', SWE: 'SE',
  // Non-EU European countries
  GBR: 'GB', NOR: 'NO', CHE: 'CH', ISL: 'IS', LIE: 'LI',
  // Additional commonly used
  UKR: 'UA', BLR: 'BY', MDA: 'MD', SRB: 'RS', MKD: 'MK',
  ALB: 'AL', MNE: 'ME', BIH: 'BA', XKX: 'XK', AND: 'AD',
  MCO: 'MC', SMR: 'SM', VAT: 'VA', TUR: 'TR', RUS: 'RU',
};

/**
 * Convert country code to ISO alpha-2 format
 * - Normalizes 'UK' to 'GB' (ISO standard)
 * - If already alpha-2 (2 chars), returns uppercase
 * - If alpha-3 (3 chars), converts using mapping
 * - Returns null if unknown
 */
export function toAlpha2(countryCode: string | null): string | null {
  if (!countryCode) return null;

  const normalized = countryCode.toUpperCase().trim();

  // Special case: UK -> GB (ISO standard is GB for United Kingdom)
  if (normalized === 'UK') {
    return 'GB';
  }

  // Already alpha-2
  if (normalized.length === 2) {
    return normalized;
  }

  // Alpha-3 - convert to alpha-2
  if (normalized.length === 3) {
    return ALPHA3_TO_ALPHA2[normalized] ?? null;
  }

  // Unknown format
  return null;
}

/**
 * Check if a country code represents the United Kingdom
 * Handles GB, GBR, and UK variants
 */
export function isUkCode(countryCode: string | null): boolean {
  if (!countryCode) return false;
  const normalized = countryCode.toUpperCase().trim();
  return normalized === 'GB' || normalized === 'GBR' || normalized === 'UK';
}

/**
 * EU member state country codes (ISO 3166-1 alpha-2)
 */
export const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

/**
 * Check if a country is in the EU (expects alpha-2 code)
 */
export function isEuCountry(countryCode: string | null): boolean {
  if (!countryCode) return false;
  return EU_COUNTRIES.has(countryCode);
}

/**
 * Enrich RouteFacts geography with resolved (geocoded) origin/destination
 * AND waypoint country codes. Mutates the passed RouteFacts in place:
 * - sets originCountry/destinationCountry as alpha-2
 * - computes isInternational and isEU
 * - normalizes countriesCrossed to alpha-2 and includes origin, destination
 *   and all via waypoints
 * - recomputes riskFlags.isUK from the normalized codes
 *
 * Waypoint countries are essential: transit countries are otherwise inferred
 * from HERE toll data, and some countries (notably the UK) have no reported
 * toll systems - a round trip EU -> UK -> EU would silently lose UK detection
 * (and its surcharge/minimum) without them.
 */
export function applyResolvedGeography(
  routeFacts: RouteFacts,
  resolvedOriginCountry: string | null,
  resolvedDestinationCountry: string | null,
  resolvedWaypointCountries: Array<string | null> = []
): void {
  const originCountry = toAlpha2(resolvedOriginCountry);
  const destinationCountry = toAlpha2(resolvedDestinationCountry);

  routeFacts.geography.originCountry = originCountry;
  routeFacts.geography.destinationCountry = destinationCountry;

  // Normalize all countriesCrossed (from tolls) to alpha-2, add origin,
  // destination and via waypoints
  const countriesSet = new Set<string>();
  for (const code of routeFacts.geography.countriesCrossed) {
    const alpha2 = toAlpha2(code);
    if (alpha2) countriesSet.add(alpha2);
  }
  if (originCountry) countriesSet.add(originCountry);
  if (destinationCountry) countriesSet.add(destinationCountry);
  for (const code of resolvedWaypointCountries) {
    const alpha2 = toAlpha2(code);
    if (alpha2) countriesSet.add(alpha2);
  }
  routeFacts.geography.countriesCrossed = Array.from(countriesSet);

  if (originCountry && destinationCountry) {
    // International when the route touches more than one country - a round
    // trip FR -> GB -> FR is international even though origin === destination
    routeFacts.geography.isInternational = routeFacts.geography.countriesCrossed.length > 1;
    // isEU is true only if both endpoints are in EU countries
    routeFacts.geography.isEU = isEuCountry(originCountry) && isEuCountry(destinationCountry);
  }

  // Update riskFlags.isUK based on normalized country codes (origin,
  // destination, waypoints and toll-derived transit countries)
  routeFacts.riskFlags.isUK =
    isUkCode(destinationCountry) ||
    routeFacts.geography.countriesCrossed.some(isUkCode);
}
