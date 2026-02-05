import { describe, it, expect } from 'vitest';
import { extractRouteFactsFromHere } from './extract-route-facts.js';
import type { HereRoutingResponse } from './route-truck.js';

// Test fixtures

/**
 * Fixture 1: Simple EU land route (Berlin to Warsaw)
 * No tolls, no ferries, no tunnels
 */
const simpleEuLandRoute: HereRoutingResponse = {
  routes: [
    {
      id: 'route-berlin-warsaw',
      sections: [
        {
          id: 'section-1',
          type: 'vehicle',
          departure: {
            time: '2024-01-15T08:00:00+01:00',
            place: {
              type: 'place',
              location: { lat: 52.52, lng: 13.405 },
            },
          },
          arrival: {
            time: '2024-01-15T14:30:00+01:00',
            place: {
              type: 'place',
              location: { lat: 52.2297, lng: 21.0122 },
            },
          },
          summary: {
            duration: 23400, // 6.5 hours in seconds
            length: 574000, // 574 km in meters
            baseDuration: 21600,
          },
          transport: { mode: 'truck' },
          actions: [
            {
              action: 'depart',
              duration: 0,
              length: 0,
              instruction: 'Head east on A10',
              offset: 0,
            },
            {
              action: 'arrive',
              duration: 0,
              length: 0,
              instruction: 'Arrive at destination',
              offset: 1,
            },
          ],
        },
      ],
    },
  ],
};

/**
 * Fixture 2: Route with ferry (Dover to Calais ferry crossing)
 */
const routeWithFerry: HereRoutingResponse = {
  routes: [
    {
      id: 'route-london-paris',
      sections: [
        {
          id: 'section-1',
          type: 'vehicle',
          departure: {
            time: '2024-01-15T06:00:00Z',
            place: {
              type: 'place',
              location: { lat: 51.5074, lng: -0.1278 },
            },
          },
          arrival: {
            time: '2024-01-15T08:00:00Z',
            place: {
              type: 'place',
              location: { lat: 51.1279, lng: 1.3134 },
            },
          },
          summary: {
            duration: 7200,
            length: 120000,
            baseDuration: 6600,
          },
          transport: { mode: 'truck' },
          actions: [
            {
              action: 'depart',
              duration: 0,
              length: 0,
              instruction: 'Head southeast on M20',
              offset: 0,
            },
          ],
        },
        {
          id: 'section-2',
          type: 'ferry',
          departure: {
            time: '2024-01-15T08:00:00Z',
            place: {
              type: 'place',
              location: { lat: 51.1279, lng: 1.3134 },
            },
          },
          arrival: {
            time: '2024-01-15T09:30:00Z',
            place: {
              type: 'place',
              location: { lat: 50.9513, lng: 1.8587 },
            },
          },
          summary: {
            duration: 5400, // 1.5 hours
            length: 50000, // ~50km crossing
            baseDuration: 5400,
          },
          transport: { mode: 'ferry' },
          actions: [
            {
              action: 'ferry',
              duration: 5400,
              length: 50000,
              instruction: 'Take the ferry from Dover to Calais',
              offset: 0,
            },
          ],
        },
        {
          id: 'section-3',
          type: 'vehicle',
          departure: {
            time: '2024-01-15T09:30:00Z',
            place: {
              type: 'place',
              location: { lat: 50.9513, lng: 1.8587 },
            },
          },
          arrival: {
            time: '2024-01-15T13:00:00Z',
            place: {
              type: 'place',
              location: { lat: 48.8566, lng: 2.3522 },
            },
          },
          summary: {
            duration: 12600,
            length: 290000,
            baseDuration: 11400,
          },
          transport: { mode: 'truck' },
          tolls: [
            {
              tolls: [
                {
                  countryCode: 'FRA',
                  tollSystem: 'Autoroutes',
                  fares: [
                    {
                      id: 'fare-1',
                      price: { type: 'total', value: '28.50', currency: 'EUR' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

/**
 * Fixture 3: Route with tolls (Munich to Milan)
 */
const routeWithTolls: HereRoutingResponse = {
  routes: [
    {
      id: 'route-munich-milan',
      sections: [
        {
          id: 'section-1',
          type: 'vehicle',
          departure: {
            time: '2024-01-15T07:00:00+01:00',
            place: {
              type: 'place',
              location: { lat: 48.1351, lng: 11.582 },
            },
          },
          arrival: {
            time: '2024-01-15T13:00:00+01:00',
            place: {
              type: 'place',
              location: { lat: 45.4642, lng: 9.19 },
            },
          },
          summary: {
            duration: 21600, // 6 hours
            length: 490000, // 490 km
            baseDuration: 19800,
          },
          transport: { mode: 'truck' },
          tolls: [
            {
              tolls: [
                {
                  countryCode: 'DEU',
                  tollSystem: 'Toll Collect',
                  fares: [
                    {
                      id: 'fare-de-1',
                      price: { type: 'total', value: '45.00', currency: 'EUR' },
                    },
                  ],
                },
                {
                  countryCode: 'AUT',
                  tollSystem: 'ASFINAG',
                  fares: [
                    {
                      id: 'fare-at-1',
                      price: { type: 'total', value: '22.50', currency: 'EUR' },
                    },
                  ],
                },
                {
                  countryCode: 'ITA',
                  tollSystem: 'Autostrade',
                  fares: [
                    {
                      id: 'fare-it-1',
                      price: { type: 'total', value: '35.80', currency: 'EUR' },
                    },
                  ],
                },
              ],
            },
          ],
          actions: [
            {
              action: 'depart',
              duration: 0,
              length: 0,
              instruction: 'Head south on A8',
              offset: 0,
            },
            {
              action: 'continue',
              duration: 3600,
              length: 80000,
              instruction: 'Continue through Brenner Pass',
              offset: 1,
            },
          ],
        },
      ],
    },
  ],
};

/**
 * Fixture 4: Route with tunnel (Lyon to Turin via Fréjus)
 */
const routeWithTunnel: HereRoutingResponse = {
  routes: [
    {
      id: 'route-lyon-turin',
      sections: [
        {
          id: 'section-1',
          type: 'vehicle',
          departure: {
            time: '2024-01-15T08:00:00+01:00',
            place: {
              type: 'place',
              location: { lat: 45.764, lng: 4.8357 },
            },
          },
          arrival: {
            time: '2024-01-15T12:30:00+01:00',
            place: {
              type: 'place',
              location: { lat: 45.0703, lng: 7.6869 },
            },
          },
          summary: {
            duration: 16200, // 4.5 hours
            length: 312000, // 312 km
            baseDuration: 14400,
          },
          transport: { mode: 'truck' },
          tolls: [
            {
              tolls: [
                {
                  countryCode: 'FRA',
                  tollSystem: 'AREA',
                  fares: [
                    {
                      id: 'fare-fr-1',
                      price: { type: 'total', value: '42.20', currency: 'EUR' },
                    },
                  ],
                },
                {
                  countryCode: 'ITA',
                  tollSystem: 'SITAF',
                  fares: [
                    {
                      id: 'fare-it-1',
                      price: { type: 'total', value: '48.90', currency: 'EUR' },
                    },
                  ],
                },
              ],
            },
          ],
          actions: [
            {
              action: 'depart',
              duration: 0,
              length: 0,
              instruction: 'Head east on A43',
              offset: 0,
            },
            {
              action: 'continue',
              duration: 1200,
              length: 12800,
              instruction: 'Enter the Fréjus Tunnel',
              offset: 1,
            },
            {
              action: 'continue',
              duration: 900,
              length: 12800,
              instruction: 'Exit tunnel and continue on A32',
              offset: 2,
            },
          ],
          notices: [
            {
              title: 'Hazardous goods restrictions in Fréjus Tunnel',
              code: 'hazardousGoodsRestriction',
              severity: 'critical',
            },
          ],
        },
      ],
    },
  ],
};

/**
 * Fixture 5: Route with Mont Blanc tunnel
 */
const routeWithMontBlanc: HereRoutingResponse = {
  routes: [
    {
      id: 'route-geneva-aosta',
      sections: [
        {
          id: 'section-1',
          type: 'vehicle',
          departure: {
            time: '2024-01-15T09:00:00+01:00',
            place: {
              type: 'place',
              location: { lat: 46.2044, lng: 6.1432 },
            },
          },
          arrival: {
            time: '2024-01-15T11:30:00+01:00',
            place: {
              type: 'place',
              location: { lat: 45.7372, lng: 7.3206 },
            },
          },
          summary: {
            duration: 9000,
            length: 145000,
            baseDuration: 8100,
          },
          transport: { mode: 'truck' },
          actions: [
            {
              action: 'continue',
              duration: 1800,
              length: 11600,
              instruction: 'Enter the Mont Blanc Tunnel towards Italy',
              offset: 0,
            },
          ],
        },
      ],
    },
  ],
};

describe('extractRouteFactsFromHere', () => {
  describe('empty/invalid responses', () => {
    it('returns defaults for empty routes array', () => {
      const result = extractRouteFactsFromHere({ routes: [] });

      expect(result.route.distanceKm).toBe(0);
      expect(result.route.durationHours).toBeNull();
      expect(result.raw.provider).toBe('here');
    });

    it('handles response with no routes property', () => {
      const result = extractRouteFactsFromHere({} as HereRoutingResponse);

      expect(result.route.distanceKm).toBe(0);
    });
  });

  describe('simple EU land route', () => {
    it('extracts distance and duration correctly', () => {
      const result = extractRouteFactsFromHere(simpleEuLandRoute);

      expect(result.route.distanceKm).toBe(574);
      expect(result.route.durationHours).toBe(6.5);
      expect(result.route.sections).toBe(1);
    });

    it('has no infrastructure flags set', () => {
      const result = extractRouteFactsFromHere(simpleEuLandRoute);

      expect(result.infrastructure.hasFerry).toBe(false);
      expect(result.infrastructure.ferrySegments).toBe(0);
      expect(result.infrastructure.hasTollRoads).toBe(false);
      expect(result.infrastructure.hasTunnel).toBe(false);
    });

    it('extracts route ID', () => {
      const result = extractRouteFactsFromHere(simpleEuLandRoute);

      expect(result.raw.hereRouteId).toBe('route-berlin-warsaw');
      expect(result.raw.provider).toBe('here');
    });
  });

  describe('route with ferry', () => {
    it('detects ferry segments', () => {
      const result = extractRouteFactsFromHere(routeWithFerry);

      expect(result.infrastructure.hasFerry).toBe(true);
      expect(result.infrastructure.ferrySegments).toBeGreaterThan(0);
    });

    it('calculates total distance across all sections', () => {
      const result = extractRouteFactsFromHere(routeWithFerry);

      // 120km + 50km + 290km = 460km
      expect(result.route.distanceKm).toBe(460);
      expect(result.route.sections).toBe(3);
    });

    it('extracts toll info from post-ferry section', () => {
      const result = extractRouteFactsFromHere(routeWithFerry);

      expect(result.infrastructure.hasTollRoads).toBe(true);
      expect(result.infrastructure.tollCountries).toContain('FRA');
      expect(result.infrastructure.tollCostEstimate).toBe(28.5);
    });

    it('sets isIsland flag when ferry to island destination', () => {
      // For this fixture, destination is France (not an island)
      const result = extractRouteFactsFromHere(routeWithFerry);

      // France is not an island, so isIsland should be false
      expect(result.riskFlags.isIsland).toBe(false);
    });
  });

  describe('route with tolls', () => {
    it('extracts toll countries', () => {
      const result = extractRouteFactsFromHere(routeWithTolls);

      expect(result.infrastructure.hasTollRoads).toBe(true);
      expect(result.infrastructure.tollCountries).toContain('DEU');
      expect(result.infrastructure.tollCountries).toContain('AUT');
      expect(result.infrastructure.tollCountries).toContain('ITA');
    });

    it('calculates total toll cost estimate', () => {
      const result = extractRouteFactsFromHere(routeWithTolls);

      // 45.00 + 22.50 + 35.80 = 103.30
      expect(result.infrastructure.tollCostEstimate).toBe(103.3);
    });

    it('extracts countries crossed from toll data', () => {
      const result = extractRouteFactsFromHere(routeWithTolls);

      expect(result.geography.countriesCrossed).toContain('DEU');
      expect(result.geography.countriesCrossed).toContain('AUT');
      expect(result.geography.countriesCrossed).toContain('ITA');
      expect(result.geography.isInternational).toBe(true);
    });

    it('sets crossesAlps flag for Alpine countries', () => {
      const result = extractRouteFactsFromHere(routeWithTolls);

      expect(result.riskFlags.crossesAlps).toBe(true);
    });
  });

  describe('route with tunnel', () => {
    it('detects Fréjus tunnel', () => {
      const result = extractRouteFactsFromHere(routeWithTunnel);

      expect(result.infrastructure.hasTunnel).toBe(true);
      expect(result.infrastructure.tunnels.length).toBeGreaterThan(0);

      const frejusTunnel = result.infrastructure.tunnels.find(
        (t) => t.name?.includes('Fréjus')
      );
      expect(frejusTunnel).toBeDefined();
      expect(frejusTunnel?.category).toBe('alpine');
    });

    it('extracts warnings from notices', () => {
      const result = extractRouteFactsFromHere(routeWithTunnel);

      expect(result.raw.warnings.length).toBeGreaterThan(0);
      expect(result.raw.warnings[0].code).toBe('hazardousGoodsRestriction');
    });

    it('sets crossesAlps flag for alpine tunnel', () => {
      const result = extractRouteFactsFromHere(routeWithTunnel);

      expect(result.riskFlags.crossesAlps).toBe(true);
    });

    it('detects truck restrictions from notices', () => {
      const result = extractRouteFactsFromHere(routeWithTunnel);

      expect(result.regulatory.truckRestricted).toBe(true);
      expect(result.regulatory.restrictionReasons.length).toBeGreaterThan(0);
    });
  });

  describe('route with Mont Blanc tunnel', () => {
    it('detects Mont Blanc tunnel', () => {
      const result = extractRouteFactsFromHere(routeWithMontBlanc);

      expect(result.infrastructure.hasTunnel).toBe(true);

      const montBlancTunnel = result.infrastructure.tunnels.find(
        (t) => t.name?.includes('Mont Blanc')
      );
      expect(montBlancTunnel).toBeDefined();
      expect(montBlancTunnel?.category).toBe('alpine');
    });
  });

  describe('risk flags', () => {
    it('does not set flags for simple route', () => {
      const result = extractRouteFactsFromHere(simpleEuLandRoute);

      expect(result.riskFlags.isUK).toBe(false);
      expect(result.riskFlags.isIsland).toBe(false);
      expect(result.riskFlags.crossesAlps).toBe(false);
      expect(result.riskFlags.isScandinavia).toBe(false);
      expect(result.riskFlags.isBaltic).toBe(false);
    });
  });

  describe('provider metadata', () => {
    it('always sets provider to here', () => {
      const result1 = extractRouteFactsFromHere(simpleEuLandRoute);
      const result2 = extractRouteFactsFromHere(routeWithTolls);

      expect(result1.raw.provider).toBe('here');
      expect(result2.raw.provider).toBe('here');
    });
  });

  describe('toll parsing resilience', () => {
    it('handles response without any tolls fields', () => {
      const response: HereRoutingResponse = {
        routes: [
          {
            id: 'route-no-tolls',
            sections: [
              {
                id: 'section-1',
                type: 'vehicle',
                departure: {
                  time: '2024-01-15T08:00:00+01:00',
                  place: {
                    type: 'place',
                    location: { lat: 52.52, lng: 13.405 },
                  },
                },
                arrival: {
                  time: '2024-01-15T14:30:00+01:00',
                  place: {
                    type: 'place',
                    location: { lat: 45.46, lng: 11.03 },
                  },
                },
                summary: {
                  duration: 23400,
                  length: 800000,
                  baseDuration: 21600,
                },
                transport: { mode: 'truck' },
                // No tolls field at all
              },
            ],
          },
        ],
      };

      const result = extractRouteFactsFromHere(response);

      expect(result.infrastructure.hasTollRoads).toBe(false);
      expect(result.infrastructure.tollCountries).toEqual([]);
      expect(result.infrastructure.tollCostEstimate).toBeNull();
      expect(result.route.distanceKm).toBe(800);
    });

    it('handles response where tolls array is empty', () => {
      const response: HereRoutingResponse = {
        routes: [
          {
            id: 'route-empty-tolls',
            sections: [
              {
                id: 'section-1',
                type: 'vehicle',
                departure: {
                  time: '2024-01-15T08:00:00+01:00',
                  place: {
                    type: 'place',
                    location: { lat: 52.52, lng: 13.405 },
                  },
                },
                arrival: {
                  time: '2024-01-15T14:30:00+01:00',
                  place: {
                    type: 'place',
                    location: { lat: 45.46, lng: 11.03 },
                  },
                },
                summary: {
                  duration: 23400,
                  length: 500000,
                  baseDuration: 21600,
                },
                transport: { mode: 'truck' },
                tolls: [], // Empty tolls array
              },
            ],
          },
        ],
      };

      const result = extractRouteFactsFromHere(response);

      expect(result.infrastructure.hasTollRoads).toBe(false);
      expect(result.infrastructure.tollCountries).toEqual([]);
      expect(result.infrastructure.tollCostEstimate).toBeNull();
    });

    it('handles tollInfo with missing tolls array', () => {
      const response: HereRoutingResponse = {
        routes: [
          {
            id: 'route-malformed-tolls',
            sections: [
              {
                id: 'section-1',
                type: 'vehicle',
                departure: {
                  time: '2024-01-15T08:00:00+01:00',
                  place: {
                    type: 'place',
                    location: { lat: 52.52, lng: 13.405 },
                  },
                },
                arrival: {
                  time: '2024-01-15T14:30:00+01:00',
                  place: {
                    type: 'place',
                    location: { lat: 45.46, lng: 11.03 },
                  },
                },
                summary: {
                  duration: 23400,
                  length: 600000,
                  baseDuration: 21600,
                },
                transport: { mode: 'truck' },
                tolls: [
                  // tollInfo exists but tolls property is missing
                  {} as { tolls: never[] },
                ],
              },
            ],
          },
        ],
      };

      const result = extractRouteFactsFromHere(response);

      expect(result.infrastructure.hasTollRoads).toBe(false);
      expect(result.infrastructure.tollCountries).toEqual([]);
      expect(result.infrastructure.tollCostEstimate).toBeNull();
    });

    it('handles mixed valid and invalid toll entries', () => {
      const response: HereRoutingResponse = {
        routes: [
          {
            id: 'route-mixed-tolls',
            sections: [
              {
                id: 'section-1',
                type: 'vehicle',
                departure: {
                  time: '2024-01-15T08:00:00+01:00',
                  place: {
                    type: 'place',
                    location: { lat: 52.52, lng: 13.405 },
                  },
                },
                arrival: {
                  time: '2024-01-15T14:30:00+01:00',
                  place: {
                    type: 'place',
                    location: { lat: 45.46, lng: 11.03 },
                  },
                },
                summary: {
                  duration: 23400,
                  length: 700000,
                  baseDuration: 21600,
                },
                transport: { mode: 'truck' },
                tolls: [
                  // Invalid entry - no tolls array
                  {} as { tolls: never[] },
                  // Valid entry
                  {
                    tolls: [
                      {
                        countryCode: 'AUT',
                        tollSystem: 'Austrian Tolls',
                        fares: [
                          {
                            id: 'fare-1',
                            price: { type: 'total', value: '15.50', currency: 'EUR' },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = extractRouteFactsFromHere(response);

      // Should extract valid data while skipping invalid
      expect(result.infrastructure.hasTollRoads).toBe(true);
      expect(result.infrastructure.tollCountries).toContain('AUT');
      expect(result.infrastructure.tollCostEstimate).toBe(15.5);
    });
  });
});
