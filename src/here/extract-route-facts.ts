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
  HereNotice,
  HereToll,
} from './route-truck.js';

// Country code sets for risk flag detection
const SCANDINAVIA_COUNTRIES = new Set(['SWE', 'NOR', 'DNK', 'FIN', 'SE', 'NO', 'DK', 'FI']);
const BALTIC_COUNTRIES = new Set(['LTU', 'LVA', 'EST', 'LT', 'LV', 'EE']);
const UK_COUNTRIES = new Set(['GBR', 'GB', 'UK']);
const ALPS_COUNTRIES = new Set(['AUT', 'CHE', 'ITA', 'AT', 'CH', 'IT']);

// Known major tunnels
const KNOWN_TUNNELS: Record<string, { name: string; category: string; country: string }> = {
  frejus: { name: 'Fréjus Tunnel', category: 'alpine', country: 'FRA/ITA' },
  fréjus: { name: 'Fréjus Tunnel', category: 'alpine', country: 'FRA/ITA' },
  'mont blanc': { name: 'Mont Blanc Tunnel', category: 'alpine', country: 'FRA/ITA' },
  'mont-blanc': { name: 'Mont Blanc Tunnel', category: 'alpine', country: 'FRA/ITA' },
  montblanc: { name: 'Mont Blanc Tunnel', category: 'alpine', country: 'FRA/ITA' },
  gotthard: { name: 'Gotthard Tunnel', category: 'alpine', country: 'CHE' },
  brenner: { name: 'Brenner Tunnel', category: 'alpine', country: 'AUT/ITA' },
  arlberg: { name: 'Arlberg Tunnel', category: 'alpine', country: 'AUT' },
  tauern: { name: 'Tauern Tunnel', category: 'alpine', country: 'AUT' },
  karawanken: { name: 'Karawanken Tunnel', category: 'alpine', country: 'AUT/SVN' },
  'san bernardino': { name: 'San Bernardino Tunnel', category: 'alpine', country: 'CHE' },
  'great st bernard': { name: 'Great St Bernard Tunnel', category: 'alpine', country: 'CHE/ITA' },
  simplon: { name: 'Simplon Tunnel', category: 'alpine', country: 'CHE' },
  lotschberg: { name: 'Lötschberg Tunnel', category: 'alpine', country: 'CHE' },
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
function normalizeCountryCode(code: string): string {
  return code.toUpperCase();
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
 */
function extractTunnelFromText(text: string): Tunnel | null {
  const lowerText = text.toLowerCase();

  // Check for known tunnels
  for (const [pattern, tunnelInfo] of Object.entries(KNOWN_TUNNELS)) {
    if (lowerText.includes(pattern)) {
      return {
        name: tunnelInfo.name,
        category: tunnelInfo.category,
        country: tunnelInfo.country,
      };
    }
  }

  // Generic tunnel detection
  if (lowerText.includes('tunnel')) {
    // Try to extract tunnel name from text
    const tunnelMatch = text.match(/(?:enter|through|via)\s+(?:the\s+)?([A-Z][a-zA-Z\s-]+)\s*[Tt]unnel/i);
    if (tunnelMatch) {
      return {
        name: tunnelMatch[1].trim() + ' Tunnel',
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
  const instruction = action.instruction.toLowerCase();
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
  return section.transport.mode === 'ferry' || section.type === 'ferry';
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
    if (section.actions) {
      for (const action of section.actions) {
        if (isFerryAction(action)) {
          ferrySegments++;
        }
      }
    }
  }

  return {
    hasFerry: ferrySegments > 0,
    ferrySegments,
  };
}

/**
 * Extract tunnel information from sections
 */
function extractTunnels(sections: HereRouteSection[]): {
  hasTunnel: boolean;
  tunnels: Tunnel[];
} {
  const tunnels: Tunnel[] = [];
  const seenTunnels = new Set<string>();

  for (const section of sections) {
    // Check actions for tunnel mentions
    if (section.actions) {
      for (const action of section.actions) {
        const tunnel = extractTunnelFromText(action.instruction);
        if (tunnel) {
          const key = tunnel.name || 'unnamed';
          if (!seenTunnels.has(key)) {
            seenTunnels.add(key);
            tunnels.push(tunnel);
          }
        }
      }
    }

    // Check notices for tunnel mentions
    if (section.notices) {
      for (const notice of section.notices) {
        const tunnel = extractTunnelFromText(notice.title);
        if (tunnel) {
          const key = tunnel.name || 'unnamed';
          if (!seenTunnels.has(key)) {
            seenTunnels.add(key);
            tunnels.push(tunnel);
          }
        }
      }
    }
  }

  return {
    hasTunnel: tunnels.length > 0,
    tunnels,
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
    if (section.notices) {
      for (const notice of section.notices) {
        warnings.push({
          code: notice.code,
          message: notice.title,
        });

        // Check for truck restrictions
        if (
          restrictionCodes.has(notice.code) ||
          notice.title.toLowerCase().includes('restriction') ||
          notice.title.toLowerCase().includes('prohibited') ||
          notice.title.toLowerCase().includes('not allowed')
        ) {
          if (!seenReasons.has(notice.title)) {
            seenReasons.add(notice.title);
            restrictionReasons.push(notice.title);
          }
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
 */
function computeRiskFlags(
  countriesCrossed: string[],
  destinationCountry: string | null,
  hasFerry: boolean,
  tunnels: Tunnel[]
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

  // Check for Alps crossing
  let crossesAlps = allCountries.some(isAlpsCountry);

  // Also check for alpine tunnels
  if (!crossesAlps) {
    crossesAlps = tunnels.some((t) => t.category === 'alpine');
  }

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
 * Extract canonical RouteFacts from HERE Routing API response
 * @param hereResponse The raw HERE routing response
 * @returns Canonical RouteFacts with extracted data
 */
export function extractRouteFactsFromHere(hereResponse: HereRoutingResponse): RouteFacts {
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

  // Extract infrastructure info
  const tollInfo = extractTolls(sections);
  const ferryInfo = extractFerryInfo(sections);
  const tunnelInfo = extractTunnels(sections);

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

  // Compute risk flags
  const riskFlags = computeRiskFlags(
    countriesCrossed,
    destinationCountry,
    ferryInfo.hasFerry,
    tunnelInfo.tunnels
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
