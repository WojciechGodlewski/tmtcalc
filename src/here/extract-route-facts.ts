/**
 * Extract canonical RouteFacts from HERE Routing API response
 */

import {
  type RouteFacts,
  type Tunnel,
  type Warning,
  createRouteFacts,
} from '../types/route-facts.js';
import type {
  HereRoutingResponse,
  HereRouteSection,
  HereRouteAction,
  HereRouteSpan,
  HereNotice,
  HereToll,
} from './route-truck.js';
import {
  decodeFlexiblePolyline,
  checkAlpsTunnels,
  type AlpsTunnelCheckResult,
  type AlpsMatchReason,
} from './flexible-polyline.js';

/**
 * Safely convert a value to lowercase string
 * Returns empty string if value is null/undefined
 */
function asLower(value: unknown): string {
  return (value ?? '').toString().toLowerCase();
}

/**
 * Remove diacritics (accents) from a string for case-insensitive matching
 * e.g., "Fréjus" -> "frejus", "Traforo" -> "traforo"
 */
function removeDiacritics(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Normalize text for tunnel matching: lowercase and remove diacritics
 */
function normalizeForMatching(text: string): string {
  return removeDiacritics(text.toLowerCase());
}

/**
 * Safely convert a value to an array
 * Returns empty array if value is not an array
 */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

// Country code sets for risk flag detection
const SCANDINAVIA_COUNTRIES = new Set(['SWE', 'NOR', 'DNK', 'FIN', 'SE', 'NO', 'DK', 'FI']);
const BALTIC_COUNTRIES = new Set(['LTU', 'LVA', 'EST', 'LT', 'LV', 'EE']);
const UK_COUNTRIES = new Set(['GBR', 'GB', 'UK']);
const ALPS_COUNTRIES = new Set(['AUT', 'CHE', 'ITA', 'AT', 'CH', 'IT']);

// Known major tunnels - patterns are normalized (lowercase, no diacritics)
const KNOWN_TUNNELS: Record<string, { name: string; category: string; country: string }> = {
  // Fréjus Tunnel variations (all normalized)
  frejus: { name: 'Fréjus Tunnel', category: 'alpine', country: 'FRA/ITA' },
  'tunnel du frejus': { name: 'Fréjus Tunnel', category: 'alpine', country: 'FRA/ITA' },
  'traforo del frejus': { name: 'Fréjus Tunnel', category: 'alpine', country: 'FRA/ITA' },
  'galleria del frejus': { name: 'Fréjus Tunnel', category: 'alpine', country: 'FRA/ITA' },
  // Mont Blanc Tunnel variations (all normalized)
  'mont blanc': { name: 'Mont Blanc Tunnel', category: 'alpine', country: 'FRA/ITA' },
  'mont-blanc': { name: 'Mont Blanc Tunnel', category: 'alpine', country: 'FRA/ITA' },
  montblanc: { name: 'Mont Blanc Tunnel', category: 'alpine', country: 'FRA/ITA' },
  'tunnel du mont blanc': { name: 'Mont Blanc Tunnel', category: 'alpine', country: 'FRA/ITA' },
  'tunnel du mont-blanc': { name: 'Mont Blanc Tunnel', category: 'alpine', country: 'FRA/ITA' },
  'traforo del monte bianco': { name: 'Mont Blanc Tunnel', category: 'alpine', country: 'FRA/ITA' },
  'monte bianco': { name: 'Mont Blanc Tunnel', category: 'alpine', country: 'FRA/ITA' },
  // Other Alpine tunnels
  gotthard: { name: 'Gotthard Tunnel', category: 'alpine', country: 'CHE' },
  brenner: { name: 'Brenner Tunnel', category: 'alpine', country: 'AUT/ITA' },
  arlberg: { name: 'Arlberg Tunnel', category: 'alpine', country: 'AUT' },
  tauern: { name: 'Tauern Tunnel', category: 'alpine', country: 'AUT' },
  karawanken: { name: 'Karawanken Tunnel', category: 'alpine', country: 'AUT/SVN' },
  'san bernardino': { name: 'San Bernardino Tunnel', category: 'alpine', country: 'CHE' },
  'great st bernard': { name: 'Great St Bernard Tunnel', category: 'alpine', country: 'CHE/ITA' },
  simplon: { name: 'Simplon Tunnel', category: 'alpine', country: 'CHE' },
  lotschberg: { name: 'Lötschberg Tunnel', category: 'alpine', country: 'CHE' },
  // Non-Alpine tunnels
  channel: { name: 'Channel Tunnel', category: 'undersea', country: 'FRA/GBR' },
  eurotunnel: { name: 'Channel Tunnel', category: 'undersea', country: 'FRA/GBR' },
};

// Island destinations (best-effort heuristics)
const ISLAND_COUNTRIES = new Set([
  'GBR', 'GB', 'UK', // Great Britain
  'IRL', 'IE', // Ireland
  'ISL', 'IS', // Iceland
  'CYP', 'CY', // Cyprus
  'MLT', 'MT', // Malta
]);

/**
 * Normalize country code to 3-letter ISO format
 */
function normalizeCountryCode(code: string | undefined | null): string {
  return asLower(code).toUpperCase();
}

/**
 * Check if a country is in Scandinavia
 */
function isScandinavia(country: string): boolean {
  return SCANDINAVIA_COUNTRIES.has(normalizeCountryCode(country));
}

/**
 * Check if a country is in the Baltic region
 */
function isBaltic(country: string): boolean {
  return BALTIC_COUNTRIES.has(normalizeCountryCode(country));
}

/**
 * Check if a country is UK
 */
function isUK(country: string): boolean {
  return UK_COUNTRIES.has(normalizeCountryCode(country));
}

/**
 * Check if a country is in the Alps region
 */
function isAlpsCountry(country: string): boolean {
  return ALPS_COUNTRIES.has(normalizeCountryCode(country));
}

/**
 * Check if a country is an island nation
 */
function isIslandCountry(country: string): boolean {
  return ISLAND_COUNTRIES.has(normalizeCountryCode(country));
}

/**
 * Extract tunnel info from text (action instruction or notice message)
 * Uses diacritics-insensitive matching for robust detection
 */
function extractTunnelFromText(text: string | undefined | null): Tunnel | null {
  if (!text) {
    return null;
  }

  // Normalize text for matching: lowercase + remove diacritics
  const normalizedText = normalizeForMatching(text);
  if (!normalizedText) {
    return null;
  }

  // Check for known tunnels using normalized patterns
  for (const [pattern, tunnelInfo] of Object.entries(KNOWN_TUNNELS)) {
    if (normalizedText.includes(pattern)) {
      return {
        name: tunnelInfo.name,
        category: tunnelInfo.category,
        country: tunnelInfo.country,
      };
    }
  }

  // Generic tunnel detection
  const lowerText = text.toLowerCase();
  if (lowerText.includes('tunnel') || lowerText.includes('traforo') || lowerText.includes('galleria')) {
    // Try to extract tunnel name from text
    const tunnelMatch = text.match(/(?:enter|through|via|take)\s+(?:the\s+)?([A-Z][a-zA-ZÀ-ÿ\s-]+)\s*[Tt]unnel/i);
    if (tunnelMatch) {
      return {
        name: tunnelMatch[1].trim() + ' Tunnel',
        category: null,
        country: null,
      };
    }
    // Try Italian patterns
    const italianMatch = text.match(/[Tt]raforo\s+(?:del\s+)?([A-Z][a-zA-ZÀ-ÿ\s-]+)/i);
    if (italianMatch) {
      return {
        name: italianMatch[1].trim() + ' Tunnel',
        category: null,
        country: null,
      };
    }
    return {
      name: null,
      category: null,
      country: null,
    };
  }

  return null;
}

/**
 * Check if an action represents a ferry segment
 */
function isFerryAction(action: HereRouteAction): boolean {
  const instruction = asLower(action.instruction);
  return (
    action.action === 'ferry' ||
    instruction.includes('ferry') ||
    instruction.includes('take the ferry') ||
    instruction.includes('board ferry')
  );
}

/**
 * Check if a section is a ferry section
 */
function isFerrySection(section: HereRouteSection): boolean {
  return section.transport?.mode === 'ferry' || section.type === 'ferry';
}

/**
 * Extract toll information from sections
 * Handles various HERE response shapes where tolls may be missing or malformed
 */
function extractTolls(sections: HereRouteSection[]): {
  hasTollRoads: boolean;
  tollCountries: string[];
  tollCostEstimate: number | null;
} {
  const tollCountries = new Set<string>();
  let totalCost = 0;
  let hasCostInfo = false;

  for (const section of sections) {
    // Skip if section.tolls is missing or not an array
    if (!section.tolls || !Array.isArray(section.tolls)) {
      continue;
    }

    for (const tollInfo of section.tolls) {
      // Skip if tollInfo.tolls is missing or not an array
      if (!tollInfo || !tollInfo.tolls || !Array.isArray(tollInfo.tolls)) {
        continue;
      }

      for (const toll of tollInfo.tolls) {
        // Skip if toll is invalid
        if (!toll || !toll.countryCode) {
          continue;
        }

        tollCountries.add(toll.countryCode);

        if (toll.fares && Array.isArray(toll.fares)) {
          for (const fare of toll.fares) {
            if (fare && fare.price && fare.price.value) {
              const value = parseFloat(fare.price.value);
              if (!isNaN(value)) {
                totalCost += value;
                hasCostInfo = true;
              }
            }
          }
        }
      }
    }
  }

  return {
    hasTollRoads: tollCountries.size > 0,
    tollCountries: Array.from(tollCountries).sort(),
    tollCostEstimate: hasCostInfo ? Math.round(totalCost * 100) / 100 : null,
  };
}

/**
 * Extract ferry information from sections and actions
 */
function extractFerryInfo(sections: HereRouteSection[]): {
  hasFerry: boolean;
  ferrySegments: number;
} {
  let ferrySegments = 0;

  for (const section of sections) {
    // Check section type
    if (isFerrySection(section)) {
      ferrySegments++;
      continue;
    }

    // Check actions within section
    for (const action of asArray<HereRouteAction>(section.actions)) {
      if (isFerryAction(action)) {
        ferrySegments++;
      }
    }
  }

  return {
    hasFerry: ferrySegments > 0,
    ferrySegments,
  };
}

/**
 * Check polylines from all sections for Alps tunnel bbox matches
 * Primary detection method for Frejus/Mont Blanc tunnels
 */
function checkPolylinesForAlpsTunnels(sections: HereRouteSection[]): AlpsTunnelCheckResult {
  // Aggregate all section polyline points for a single check
  const allPoints: Array<{ lat: number; lng: number }> = [];

  for (const section of sections) {
    if (!section.polyline) continue;

    try {
      const points = decodeFlexiblePolyline(section.polyline);
      allPoints.push(...points);
    } catch {
      // Ignore polyline decode errors, continue with other sections
    }
  }

  // If no points, return empty result
  if (allPoints.length === 0) {
    return {
      frejus: false,
      montBlanc: false,
      pointsChecked: 0,
      details: {
        frejus: { matched: false, pointsInside: 0 },
        montBlanc: { matched: false, pointsInside: 0 },
      },
    };
  }

  // Single comprehensive check of all points
  return checkAlpsTunnels(allPoints);
}

/**
 * Check if a tunnel name matches Frejus or Mont Blanc (Alps surcharge tunnels)
 */
function isAlpsSurchargeTunnel(tunnelName: string | null): boolean {
  if (!tunnelName) return false;

  const normalized = normalizeForMatching(tunnelName);

  // Fréjus patterns
  if (
    normalized.includes('frejus') ||
    normalized.includes('traforo del frejus') ||
    normalized.includes('tunnel du frejus') ||
    normalized.includes('galleria del frejus')
  ) {
    return true;
  }

  // Mont Blanc patterns
  if (
    normalized.includes('mont blanc') ||
    normalized.includes('mont-blanc') ||
    normalized.includes('montblanc') ||
    normalized.includes('monte bianco') ||
    normalized.includes('traforo del monte bianco')
  ) {
    return true;
  }

  return false;
}

/**
 * Extract tunnel info from a span
 */
function extractTunnelFromSpan(span: HereRouteSpan): Tunnel | null {
  // Check if span is marked as tunnel
  if (!span.tunnel) {
    return null;
  }

  // Try to get tunnel name from span names
  let tunnelName: string | null = null;
  if (span.names && span.names.length > 0) {
    tunnelName = span.names[0].value || null;
  }

  // If we have a name, try to match known tunnels
  if (tunnelName) {
    const normalizedName = normalizeForMatching(tunnelName);

    for (const [pattern, tunnelInfo] of Object.entries(KNOWN_TUNNELS)) {
      if (normalizedName.includes(pattern)) {
        return {
          name: tunnelInfo.name,
          category: tunnelInfo.category,
          country: tunnelInfo.country,
        };
      }
    }

    // Return tunnel with detected name but unknown category
    return {
      name: tunnelName,
      category: null,
      country: span.countryCode || null,
    };
  }

  // Tunnel without name
  return {
    name: null,
    category: null,
    country: span.countryCode || null,
  };
}

/**
 * Extract tunnel information from sections
 * Uses polyline geofencing (primary) and action text (secondary) for detection
 */
function extractTunnels(
  sections: HereRouteSection[],
  alpsMatch: AlpsTunnelCheckResult
): {
  hasTunnel: boolean;
  tunnels: Tunnel[];
  /** Set to true only if Frejus or Mont Blanc tunnel detected via bbox */
  hasAlpsSurchargeTunnel: boolean;
} {
  const tunnels: Tunnel[] = [];
  const seenTunnels = new Set<string>();
  let hasGenericTunnel = false;

  // PRIMARY: Use polyline geofencing for Frejus/Mont Blanc
  if (alpsMatch.frejus) {
    const frejusTunnel: Tunnel = {
      name: 'Fréjus Tunnel',
      category: 'alpine',
      country: 'FRA/ITA',
    };
    seenTunnels.add('Fréjus Tunnel');
    tunnels.push(frejusTunnel);
  }

  if (alpsMatch.montBlanc) {
    const montBlancTunnel: Tunnel = {
      name: 'Mont Blanc Tunnel',
      category: 'alpine',
      country: 'FRA/ITA',
    };
    seenTunnels.add('Mont Blanc Tunnel');
    tunnels.push(montBlancTunnel);
  }

  // SECONDARY: Check actions for other tunnel mentions
  for (const section of sections) {
    for (const action of asArray<HereRouteAction>(section.actions)) {
      const tunnel = extractTunnelFromText(action.instruction);
      if (tunnel) {
        if (tunnel.name) {
          // Skip if already added via bbox detection
          if (!seenTunnels.has(tunnel.name)) {
            seenTunnels.add(tunnel.name);
            tunnels.push(tunnel);
          }
        } else {
          // Generic tunnel mention without name
          hasGenericTunnel = true;
        }
      }
    }

    // Check notices for tunnel mentions
    for (const notice of asArray<HereNotice>(section.notices)) {
      const tunnel = extractTunnelFromText(notice.title);
      if (tunnel) {
        if (tunnel.name) {
          if (!seenTunnels.has(tunnel.name)) {
            seenTunnels.add(tunnel.name);
            tunnels.push(tunnel);
          }
        } else {
          hasGenericTunnel = true;
        }
      }
    }
  }

  // hasTunnel is true if we found any tunnels via bbox or text
  const hasTunnel = tunnels.length > 0 || hasGenericTunnel;

  // Alps surcharge tunnel is detected via polyline geofencing only
  const hasAlpsSurchargeTunnel = alpsMatch.frejus || alpsMatch.montBlanc;

  return {
    hasTunnel,
    tunnels,
    hasAlpsSurchargeTunnel,
  };
}

/**
 * Extract warnings and restriction info from notices
 */
function extractRestrictions(sections: HereRouteSection[]): {
  truckRestricted: boolean;
  restrictionReasons: string[];
  warnings: Warning[];
} {
  const restrictionReasons: string[] = [];
  const warnings: Warning[] = [];
  const seenReasons = new Set<string>();

  const restrictionCodes = new Set([
    'truckRestriction',
    'vehicleRestriction',
    'weightRestriction',
    'heightRestriction',
    'lengthRestriction',
    'hazardousGoodsRestriction',
  ]);

  for (const section of sections) {
    for (const notice of asArray<HereNotice>(section.notices)) {
      const noticeCode = notice.code ?? '';
      const noticeTitle = notice.title ?? '';
      const lowerTitle = asLower(noticeTitle);

      warnings.push({
        code: noticeCode || 'unknown',
        message: noticeTitle,
      });

      // Check for truck restrictions
      if (
        restrictionCodes.has(noticeCode) ||
        lowerTitle.includes('restriction') ||
        lowerTitle.includes('prohibited') ||
        lowerTitle.includes('not allowed')
      ) {
        if (noticeTitle && !seenReasons.has(noticeTitle)) {
          seenReasons.add(noticeTitle);
          restrictionReasons.push(noticeTitle);
        }
      }
    }
  }

  return {
    truckRestricted: restrictionReasons.length > 0,
    restrictionReasons,
    warnings,
  };
}

/**
 * Compute risk flags based on countries and route characteristics
 * @param hasAlpsSurchargeTunnel - True only if Frejus or Mont Blanc tunnel detected
 */
function computeRiskFlags(
  countriesCrossed: string[],
  destinationCountry: string | null,
  hasFerry: boolean,
  hasAlpsSurchargeTunnel: boolean
): {
  isUK: boolean;
  isIsland: boolean;
  crossesAlps: boolean;
  isScandinavia: boolean;
  isBaltic: boolean;
} {
  const allCountries = [...countriesCrossed];
  if (destinationCountry) {
    allCountries.push(destinationCountry);
  }

  // Check for UK
  const hasUK = allCountries.some(isUK);

  // Check for Scandinavia
  const hasScandinavia = allCountries.some(isScandinavia);

  // Check for Baltic
  const hasBaltic = allCountries.some(isBaltic);

  // crossesAlps is TRUE only when Frejus or Mont Blanc tunnel is detected
  // This is used for the +200 EUR Alps surcharge
  // Other tunnels (even alpine ones) do NOT trigger the surcharge
  const crossesAlps = hasAlpsSurchargeTunnel;

  // Island detection: ferry + destination is island country
  const destIsIsland = destinationCountry ? isIslandCountry(destinationCountry) : false;
  const isIsland = hasFerry && destIsIsland;

  return {
    isUK: hasUK,
    isIsland,
    crossesAlps,
    isScandinavia: hasScandinavia,
    isBaltic: hasBaltic,
  };
}

/**
 * Extract route ID from HERE response
 */
function extractRouteId(response: HereRoutingResponse): string | null {
  if (response.routes && response.routes.length > 0) {
    return response.routes[0].id || null;
  }
  return null;
}

/**
 * Extract countries from toll information (best effort)
 * Preserves order of first appearance to maintain origin/destination
 * Handles various HERE response shapes where tolls may be missing or malformed
 */
function extractCountriesFromTolls(sections: HereRouteSection[]): string[] {
  const seen = new Set<string>();
  const countries: string[] = [];

  for (const section of sections) {
    // Skip if section.tolls is missing or not an array
    if (!section.tolls || !Array.isArray(section.tolls)) {
      continue;
    }

    for (const tollInfo of section.tolls) {
      // Skip if tollInfo.tolls is missing or not an array
      if (!tollInfo || !tollInfo.tolls || !Array.isArray(tollInfo.tolls)) {
        continue;
      }

      for (const toll of tollInfo.tolls) {
        // Skip if toll is invalid or missing countryCode
        if (!toll || !toll.countryCode) {
          continue;
        }

        if (!seen.has(toll.countryCode)) {
          seen.add(toll.countryCode);
          countries.push(toll.countryCode);
        }
      }
    }
  }

  return countries;
}

/**
 * Alps match override - allows passing pre-computed Alps detection
 * (e.g., from waypoint proximity detection when polyline decoding fails)
 */
export interface AlpsMatchOverride {
  frejus: boolean;
  montBlanc: boolean;
}

/**
 * Extract canonical RouteFacts from HERE Routing API response
 * @param hereResponse The raw HERE routing response
 * @param alpsMatchOverride Optional pre-computed Alps match (e.g., from waypoint proximity)
 * @returns Canonical RouteFacts with extracted data
 */
export function extractRouteFactsFromHere(
  hereResponse: HereRoutingResponse,
  alpsMatchOverride?: AlpsMatchOverride
): RouteFacts {
  if (!hereResponse.routes || hereResponse.routes.length === 0) {
    return createRouteFacts();
  }

  const route = hereResponse.routes[0];
  const sections = route.sections || [];

  // Calculate totals from sections
  let totalLengthMeters = 0;
  let totalDurationSeconds = 0;

  for (const section of sections) {
    if (section.summary) {
      totalLengthMeters += section.summary.length || 0;
      totalDurationSeconds += section.summary.duration || 0;
    }
  }

  // Convert to km and hours
  const distanceKm = Math.round((totalLengthMeters / 1000) * 100) / 100;
  const durationHours = totalDurationSeconds > 0
    ? Math.round((totalDurationSeconds / 3600) * 100) / 100
    : null;

  // Check polylines for Alps tunnels (primary detection method)
  // Use override if provided (e.g., from waypoint proximity detection)
  let alpsMatch: AlpsTunnelCheckResult;
  if (alpsMatchOverride) {
    // Convert override to AlpsTunnelCheckResult format
    alpsMatch = {
      frejus: alpsMatchOverride.frejus,
      montBlanc: alpsMatchOverride.montBlanc,
      pointsChecked: 0,
      details: {
        frejus: {
          matched: alpsMatchOverride.frejus,
          pointsInside: 0,
          matchReason: alpsMatchOverride.frejus ? 'waypointProximity' : 'none',
        },
        montBlanc: {
          matched: alpsMatchOverride.montBlanc,
          pointsInside: 0,
          matchReason: alpsMatchOverride.montBlanc ? 'waypointProximity' : 'none',
        },
      },
    };
  } else {
    alpsMatch = checkPolylinesForAlpsTunnels(sections);
  }

  // Extract infrastructure info
  const tollInfo = extractTolls(sections);
  const ferryInfo = extractFerryInfo(sections);
  const tunnelInfo = extractTunnels(sections, alpsMatch);

  // Extract regulatory info
  const restrictionInfo = extractRestrictions(sections);

  // Extract countries (best effort from toll data)
  const countriesCrossed = extractCountriesFromTolls(sections);

  // Determine origin/destination countries (first and last toll countries as proxy)
  const originCountry = countriesCrossed.length > 0 ? countriesCrossed[0] : null;
  const destinationCountry = countriesCrossed.length > 0
    ? countriesCrossed[countriesCrossed.length - 1]
    : null;

  // Compute geography
  const isInternational = countriesCrossed.length > 1 ? true : countriesCrossed.length === 1 ? false : null;

  // Compute risk flags - crossesAlps only true for Frejus/Mont Blanc
  const riskFlags = computeRiskFlags(
    countriesCrossed,
    destinationCountry,
    ferryInfo.hasFerry,
    tunnelInfo.hasAlpsSurchargeTunnel
  );

  return {
    route: {
      distanceKm,
      durationHours,
      sections: sections.length,
    },
    geography: {
      originCountry,
      destinationCountry,
      countriesCrossed,
      isInternational,
      isEU: null, // Cannot determine from HERE response alone
    },
    infrastructure: {
      hasFerry: ferryInfo.hasFerry,
      ferrySegments: ferryInfo.ferrySegments,
      hasTollRoads: tollInfo.hasTollRoads,
      tollCountries: tollInfo.tollCountries,
      tollCostEstimate: tollInfo.tollCostEstimate,
      hasTunnel: tunnelInfo.hasTunnel,
      tunnels: tunnelInfo.tunnels,
    },
    regulatory: {
      truckRestricted: restrictionInfo.truckRestricted,
      restrictionReasons: restrictionInfo.restrictionReasons,
      adrRequired: null, // Cannot determine from HERE response alone
      lowEmissionZones: [], // Would need additional API call
      weightLimitViolations: null, // Cannot determine from HERE response alone
    },
    riskFlags,
    raw: {
      provider: 'here',
      hereRouteId: extractRouteId(hereResponse),
      warnings: restrictionInfo.warnings,
    },
  };
}
