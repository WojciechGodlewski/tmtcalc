/**
 * Country exclusion support for HERE Routing v8 (exclude[countries]=...).
 *
 * All mapping/validation logic lives here - route handlers only call
 * normalizeExcludeCountries(). Input accepts alpha-2 and alpha-3 codes
 * (plus UK as an alias for GBR), as an array or a comma-separated string;
 * output is the canonical alpha-3 list HERE expects.
 *
 * This is a STRICT exclusion, not a soft preference: HERE will not route
 * through excluded territories at all, and requests whose origin or
 * destination lie inside an excluded country are rejected before routing.
 */

import { ApiError } from '../errors.js';

/**
 * Supported exclusion countries: alpha-2 -> alpha-3.
 * Alpha-3 values are also accepted directly as input.
 */
const EXCLUDE_ALPHA2_TO_ALPHA3: Record<string, string> = {
  CH: 'CHE',
  AT: 'AUT',
  DE: 'DEU',
  PL: 'POL',
  CZ: 'CZE',
  SK: 'SVK',
  FR: 'FRA',
  IT: 'ITA',
  GB: 'GBR',
  NL: 'NLD',
  BE: 'BEL',
  ES: 'ESP',
  PT: 'PRT',
  SI: 'SVN',
  HR: 'HRV',
  HU: 'HUN',
  RO: 'ROU',
  BG: 'BGR',
  DK: 'DNK',
  SE: 'SWE',
  NO: 'NOR',
  FI: 'FIN',
};

const SUPPORTED_ALPHA3 = new Set(Object.values(EXCLUDE_ALPHA2_TO_ALPHA3));

/**
 * Normalize exclude-countries input to a deduplicated alpha-3 list for HERE.
 *
 * Accepts: undefined/null (-> []), an array of strings, or a comma-separated
 * string. Codes are trimmed and case-insensitive; UK is an alias for GBR.
 *
 * @throws ApiError (400 VALIDATION_ERROR) "Unsupported exclude country code: XX"
 */
export function normalizeExcludeCountries(input: unknown): string[] {
  if (input === undefined || input === null) return [];

  let rawItems: string[];
  if (Array.isArray(input)) {
    rawItems = input.map((item) => String(item ?? ''));
  } else if (typeof input === 'string') {
    rawItems = input.split(',');
  } else {
    throw new ApiError(
      'VALIDATION_ERROR',
      'excludeCountries must be an array of country codes or a comma-separated string',
      400
    );
  }

  const result: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawItems) {
    const code = raw.trim().toUpperCase();
    if (!code) continue;

    let alpha3: string | undefined;
    if (code === 'UK') {
      alpha3 = 'GBR';
    } else if (EXCLUDE_ALPHA2_TO_ALPHA3[code]) {
      alpha3 = EXCLUDE_ALPHA2_TO_ALPHA3[code];
    } else if (SUPPORTED_ALPHA3.has(code)) {
      alpha3 = code;
    }

    if (!alpha3) {
      throw new ApiError('VALIDATION_ERROR', `Unsupported exclude country code: ${code}`, 400);
    }

    if (!seen.has(alpha3)) {
      seen.add(alpha3);
      result.push(alpha3);
    }
  }

  return result;
}

/**
 * Alpha-2 set for the given normalized alpha-3 exclusion list, for comparing
 * against RouteFacts geography (which is always alpha-2).
 */
export function excludedAlpha2Set(alpha3Codes: string[]): Set<string> {
  const reverse = new Map(Object.entries(EXCLUDE_ALPHA2_TO_ALPHA3).map(([a2, a3]) => [a3, a2]));
  const set = new Set<string>();
  for (const a3 of alpha3Codes) {
    const a2 = reverse.get(a3);
    if (a2) set.add(a2);
  }
  return set;
}

/** Supported input codes, for docs/UI hints */
export function supportedExcludeCountries(): { alpha2: string[]; alpha3: string[] } {
  return {
    alpha2: Object.keys(EXCLUDE_ALPHA2_TO_ALPHA3).sort(),
    alpha3: Array.from(SUPPORTED_ALPHA3).sort(),
  };
}
