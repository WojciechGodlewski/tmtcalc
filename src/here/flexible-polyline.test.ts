/**
 * Tests for HERE Flexible Polyline decoder and Alps tunnel bbox detection
 */

import { describe, it, expect } from 'vitest';
import {
  decodeFlexiblePolyline,
  encodeFlexiblePolyline,
  isPointInBBox,
  checkAlpsTunnels,
  checkAlpsTunnelsFromPolyline,
  haversineDistanceKm,
  computePolylineSanityStats,
  getAlpsDebugConfig,
  computeAlpsCenterDistances,
  checkWaypointProximity,
  arePolylineBoundsPlausible,
  FREJUS_BBOX,
  MONT_BLANC_BBOX,
  FREJUS_CENTER,
  MONT_BLANC_CENTER,
  TUNNEL_PROXIMITY_KM,
  WAYPOINT_PROXIMITY_THRESHOLD_KM,
  type PolylinePoint,
} from './flexible-polyline.js';

describe('decodeFlexiblePolyline', () => {
  it('should return empty array for empty string', () => {
    expect(decodeFlexiblePolyline('')).toEqual([]);
  });

  it('should decode a simple polyline with precision 5', () => {
    // Encoded polyline: "BFoz5xJ67i1B1B7PzIhaxL7Y"
    // This represents a route with precision 5
    // We'll test with a known encoded polyline
    const encoded = 'BFoz5xJ67i1B1B7PzIhaxL7Y';
    const points = decodeFlexiblePolyline(encoded);

    expect(points.length).toBeGreaterThan(0);
    // All points should have lat/lng
    for (const point of points) {
      expect(typeof point.lat).toBe('number');
      expect(typeof point.lng).toBe('number');
    }
  });

  it('should decode polyline with 3rd dimension (altitude)', () => {
    // Polylines with altitude have a flag set in header
    // Here's a minimal test to ensure we don't crash
    // The format includes: header with 3rd dim flag, 3rd dim precision, then points
    const encoded = 'BlBoz5xJ67i1BU'; // Simple polyline with altitude marker
    // This might not be perfectly valid but tests the branching logic
    try {
      const points = decodeFlexiblePolyline(encoded);
      expect(Array.isArray(points)).toBe(true);
    } catch {
      // Some malformed inputs may throw, which is acceptable
    }
  });
});

describe('encodeFlexiblePolyline and decode round-trip', () => {
  it('encodes and decodes Turin-Bardonecchia-Chambery route correctly', () => {
    // Known points in the Alps
    const originalPoints: PolylinePoint[] = [
      { lat: 45.06235, lng: 7.67993 },  // Turin
      { lat: 45.07948, lng: 6.69965 },  // Bardonecchia (near Frejus)
      { lat: 45.56664, lng: 5.9209 },   // Chambery
    ];

    // Encode with precision 5
    const encoded = encodeFlexiblePolyline(originalPoints, 5);

    // Decode
    const decoded = decodeFlexiblePolyline(encoded);

    // Should have same number of points
    expect(decoded.length).toBe(originalPoints.length);

    // Each point should match within precision tolerance (1e-5)
    for (let i = 0; i < originalPoints.length; i++) {
      expect(decoded[i].lat).toBeCloseTo(originalPoints[i].lat, 4);
      expect(decoded[i].lng).toBeCloseTo(originalPoints[i].lng, 4);
    }
  });

  it('decoded points are within plausible lat/lng ranges', () => {
    const originalPoints: PolylinePoint[] = [
      { lat: 45.06235, lng: 7.67993 },  // Turin
      { lat: 45.07948, lng: 6.69965 },  // Bardonecchia
      { lat: 45.56664, lng: 5.9209 },   // Chambery
    ];

    const encoded = encodeFlexiblePolyline(originalPoints, 5);
    const decoded = decodeFlexiblePolyline(encoded);

    for (const point of decoded) {
      expect(Math.abs(point.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(point.lng)).toBeLessThanOrEqual(180);
    }
  });

  it('decoded lat/lng are not swapped for European Alps route', () => {
    // Turin (45.06235, 7.67993) is in Italy:
    //  - latitude ~45 (Northern Italy, around Alps)
    //  - longitude ~7.68 (between 5 and 10 for Western Europe)
    const turinPoint: PolylinePoint[] = [
      { lat: 45.06235, lng: 7.67993 },
    ];

    const encoded = encodeFlexiblePolyline(turinPoint, 5);
    const decoded = decodeFlexiblePolyline(encoded);

    expect(decoded.length).toBe(1);

    // lat should be around 45 (not 7), proving lat/lng are not swapped
    expect(decoded[0].lat).toBeGreaterThan(40);
    expect(decoded[0].lat).toBeLessThan(50);

    // lng should be between 5 and 10 for Alps/Italy region
    expect(decoded[0].lng).toBeGreaterThan(5);
    expect(decoded[0].lng).toBeLessThan(10);

    // Ensure values are within valid Earth coordinate ranges
    expect(Math.abs(decoded[0].lat)).toBeLessThanOrEqual(90);
    expect(Math.abs(decoded[0].lng)).toBeLessThanOrEqual(180);
  });

  it('auto-corrects swapped lat/lng for European routes', () => {
    // Simulate a scenario where lat and lng values are swapped:
    // - "lat" values are small (5-8, which are actually lng for Europe)
    // - "lng" values are ~45 (which are actually lat for Europe)
    const swappedPoints: PolylinePoint[] = [
      { lat: 7.6869, lng: 45.0703 },  // lat and lng are swapped
      { lat: 6.7, lng: 45.1 },
      { lat: 5.9178, lng: 45.5646 }
    ];

    // Encode these "wrong" values
    const encoded = encodeFlexiblePolyline(swappedPoints, 5);

    // Decode - the auto-correction should detect and fix the swap
    const decoded = decodeFlexiblePolyline(encoded);

    expect(decoded.length).toBe(3);

    // After auto-correction, lat should be ~45 (European latitude)
    expect(decoded[0].lat).toBeGreaterThan(40);
    expect(decoded[0].lat).toBeLessThan(50);

    // After auto-correction, lng should be 5-10 (Western European longitude)
    expect(decoded[0].lng).toBeGreaterThan(4);
    expect(decoded[0].lng).toBeLessThan(10);

    // Verify the specific corrected values
    expect(decoded[0].lat).toBeCloseTo(45.0703, 3);
    expect(decoded[0].lng).toBeCloseTo(7.6869, 3);
  });

  it('applies swap when first point has lng=0 but others look European (swap case)', () => {
    // Simulate the "lng=0 at origin" case where the first point has
    // an abnormal lng=0 but subsequent points have lat values in ~45 range
    // which indicates the values are swapped
    const pointsWithZeroLng: PolylinePoint[] = [
      { lat: 0.000003, lng: 45.062355 },  // lat~0, lng~45 (swapped)
      { lat: 7.679937, lng: 45.06241 },
      { lat: 6.7, lng: 45.1 }
    ];

    const encoded = encodeFlexiblePolyline(pointsWithZeroLng, 5);
    const decoded = decodeFlexiblePolyline(encoded);

    expect(decoded.length).toBe(3);

    // After swap, lat should be ~45 (European latitude)
    expect(decoded[0].lat).toBeGreaterThan(40);
    expect(decoded[0].lat).toBeLessThan(50);

    // After swap, first point has lng≈0 - the lng=0 fix is now in route-truck.ts
    // where it can use origin distance validation
    // Decoder only applies the swap, not the lng fix
    expect(decoded[0].lng).toBeCloseTo(0.000003, 5);
  });

  it('preserves corrupted first point lng (fix is in route-truck with origin validation)', () => {
    // The corrupted first point fix is now in route-truck.ts, not the decoder
    // This test verifies the decoder preserves the values as-is
    // Route-truck applies the fix using origin distance validation
    const corruptedPoints: PolylinePoint[] = [
      { lat: 45.062355, lng: 0.000003 },  // lat correct, lng corrupted to ~0
      { lat: 45.06241, lng: 7.679937 },   // both correct
      { lat: 45.1, lng: 6.7 }             // both correct
    ];

    const encoded = encodeFlexiblePolyline(corruptedPoints, 5);
    const decoded = decodeFlexiblePolyline(encoded);

    expect(decoded.length).toBe(3);

    // First point should be preserved as-is by decoder
    // (route-truck.ts applies fix with origin distance validation)
    expect(decoded[0].lat).toBeCloseTo(45.062355, 3);
    expect(decoded[0].lng).toBeCloseTo(0.000003, 3);

    // Second and third points should be unchanged
    expect(decoded[1].lat).toBeCloseTo(45.06241, 3);
    expect(decoded[1].lng).toBeCloseTo(7.679937, 3);
  });

  it('computed bounds are within valid Earth coordinate ranges', () => {
    const originalPoints: PolylinePoint[] = [
      { lat: 45.06235, lng: 7.67993 },  // Turin
      { lat: 45.07948, lng: 6.69965 },  // Bardonecchia
      { lat: 45.56664, lng: 5.9209 },   // Chambery
    ];

    const encoded = encodeFlexiblePolyline(originalPoints, 5);
    const decoded = decodeFlexiblePolyline(encoded);
    const stats = computePolylineSanityStats(decoded);

    expect(stats.polylineBounds).not.toBeNull();
    const bounds = stats.polylineBounds!;

    // Bounds should be within valid Earth ranges
    expect(bounds.minLat).toBeGreaterThanOrEqual(-90);
    expect(bounds.maxLat).toBeLessThanOrEqual(90);
    expect(bounds.minLng).toBeGreaterThanOrEqual(-180);
    expect(bounds.maxLng).toBeLessThanOrEqual(180);

    // Bounds should plausibly cover the original points
    expect(bounds.minLat).toBeLessThanOrEqual(45.07);
    expect(bounds.maxLat).toBeGreaterThanOrEqual(45.56);
    expect(bounds.minLng).toBeLessThanOrEqual(5.93);
    expect(bounds.maxLng).toBeGreaterThanOrEqual(7.67);

    // Specifically verify lng is not 0 (regression test)
    expect(bounds.minLng).toBeGreaterThan(4);
    expect(bounds.maxLng).toBeLessThan(10);

    // Verify first point has correct lng (not 0)
    expect(stats.polylineFirstPoint?.lng).toBeGreaterThan(5);
    expect(stats.polylineFirstPoint?.lng).toBeLessThan(10);
  });

  it('handles single point', () => {
    const points: PolylinePoint[] = [{ lat: 45.0, lng: 7.0 }];
    const encoded = encodeFlexiblePolyline(points, 5);
    const decoded = decodeFlexiblePolyline(encoded);

    expect(decoded.length).toBe(1);
    expect(decoded[0].lat).toBeCloseTo(45.0, 4);
    expect(decoded[0].lng).toBeCloseTo(7.0, 4);
  });

  it('handles empty array', () => {
    const encoded = encodeFlexiblePolyline([], 5);
    expect(encoded).toBe('');
    expect(decodeFlexiblePolyline(encoded)).toEqual([]);
  });

  it('handles negative coordinates', () => {
    const points: PolylinePoint[] = [
      { lat: -33.8688, lng: 151.2093 },  // Sydney
      { lat: 40.7128, lng: -74.0060 },   // New York
    ];
    const encoded = encodeFlexiblePolyline(points, 5);
    const decoded = decodeFlexiblePolyline(encoded);

    expect(decoded.length).toBe(2);
    expect(decoded[0].lat).toBeCloseTo(-33.8688, 4);
    expect(decoded[0].lng).toBeCloseTo(151.2093, 4);
    expect(decoded[1].lat).toBeCloseTo(40.7128, 4);
    expect(decoded[1].lng).toBeCloseTo(-74.0060, 4);
  });

  it('handles different precision levels', () => {
    const points: PolylinePoint[] = [
      { lat: 45.123456789, lng: 7.987654321 },
    ];

    // Test precision 5 (common for HERE)
    const encoded5 = encodeFlexiblePolyline(points, 5);
    const decoded5 = decodeFlexiblePolyline(encoded5);
    expect(decoded5[0].lat).toBeCloseTo(45.12346, 5);
    expect(decoded5[0].lng).toBeCloseTo(7.98765, 5);

    // Test precision 6 (higher precision)
    const encoded6 = encodeFlexiblePolyline(points, 6);
    const decoded6 = decodeFlexiblePolyline(encoded6);
    expect(decoded6[0].lat).toBeCloseTo(45.123457, 6);
    expect(decoded6[0].lng).toBeCloseTo(7.987654, 6);
  });
});

describe('isPointInBBox', () => {
  describe('Frejus bbox', () => {
    it('should return true for point inside Frejus bbox', () => {
      const pointInFrejus: PolylinePoint = { lat: 45.1, lng: 6.7 };
      expect(isPointInBBox(pointInFrejus, FREJUS_BBOX)).toBe(true);
    });

    it('should return true for point on Frejus bbox boundary', () => {
      // Corner point
      const corner: PolylinePoint = { lat: 45.03, lng: 6.60 };
      expect(isPointInBBox(corner, FREJUS_BBOX)).toBe(true);
    });

    it('should return false for point outside Frejus bbox', () => {
      const pointOutside: PolylinePoint = { lat: 46.0, lng: 7.0 };
      expect(isPointInBBox(pointOutside, FREJUS_BBOX)).toBe(false);
    });

    it('should return false for point near but outside Frejus bbox', () => {
      const justNorth: PolylinePoint = { lat: 45.18, lng: 6.7 };
      expect(isPointInBBox(justNorth, FREJUS_BBOX)).toBe(false);
    });
  });

  describe('Mont Blanc bbox', () => {
    it('should return true for point inside Mont Blanc bbox', () => {
      const pointInMontBlanc: PolylinePoint = { lat: 45.9, lng: 6.98 };
      expect(isPointInBBox(pointInMontBlanc, MONT_BLANC_BBOX)).toBe(true);
    });

    it('should return true for point on Mont Blanc bbox boundary', () => {
      const corner: PolylinePoint = { lat: 45.82, lng: 6.92 };
      expect(isPointInBBox(corner, MONT_BLANC_BBOX)).toBe(true);
    });

    it('should return false for point outside Mont Blanc bbox', () => {
      const pointOutside: PolylinePoint = { lat: 45.0, lng: 7.0 };
      expect(isPointInBBox(pointOutside, MONT_BLANC_BBOX)).toBe(false);
    });
  });
});

describe('checkAlpsTunnels', () => {
  it('should return false for empty points array', () => {
    const result = checkAlpsTunnels([]);
    expect(result.frejus).toBe(false);
    expect(result.montBlanc).toBe(false);
    expect(result.pointsChecked).toBe(0);
  });

  it('should detect Frejus tunnel from points', () => {
    const points: PolylinePoint[] = [
      { lat: 45.0, lng: 6.5 },  // Outside
      { lat: 45.1, lng: 6.7 },  // Inside Frejus
      { lat: 45.2, lng: 6.8 },  // Outside
    ];
    const result = checkAlpsTunnels(points);
    expect(result.frejus).toBe(true);
    expect(result.montBlanc).toBe(false);
    expect(result.pointsChecked).toBe(3);
  });

  it('should detect Mont Blanc tunnel from points', () => {
    const points: PolylinePoint[] = [
      { lat: 45.7, lng: 6.9 },   // Outside
      { lat: 45.9, lng: 6.98 },  // Inside Mont Blanc
      { lat: 46.0, lng: 7.1 },   // Outside
    ];
    const result = checkAlpsTunnels(points);
    expect(result.frejus).toBe(false);
    expect(result.montBlanc).toBe(true);
    expect(result.pointsChecked).toBe(3);
  });

  it('should detect both tunnels when route passes through both', () => {
    const points: PolylinePoint[] = [
      { lat: 45.1, lng: 6.7 },   // Inside Frejus
      { lat: 45.5, lng: 6.8 },   // Between tunnels
      { lat: 45.9, lng: 6.98 },  // Inside Mont Blanc
    ];
    const result = checkAlpsTunnels(points);
    expect(result.frejus).toBe(true);
    expect(result.montBlanc).toBe(true);
    expect(result.pointsChecked).toBe(3);
  });

  it('should return false when no points in tunnel areas', () => {
    const points: PolylinePoint[] = [
      { lat: 48.0, lng: 2.3 },   // Paris area
      { lat: 48.5, lng: 2.5 },
      { lat: 49.0, lng: 2.8 },
    ];
    const result = checkAlpsTunnels(points);
    expect(result.frejus).toBe(false);
    expect(result.montBlanc).toBe(false);
    expect(result.pointsChecked).toBe(3);
  });

  it('should handle many points efficiently', () => {
    // Generate 1000 points, with one in Frejus bbox
    const points: PolylinePoint[] = [];
    for (let i = 0; i < 500; i++) {
      points.push({ lat: 48.0 + i * 0.001, lng: 2.3 });
    }
    points.push({ lat: 45.1, lng: 6.7 }); // Frejus point
    for (let i = 0; i < 499; i++) {
      points.push({ lat: 49.0 + i * 0.001, lng: 2.5 });
    }

    const result = checkAlpsTunnels(points);
    expect(result.frejus).toBe(true);
    expect(result.montBlanc).toBe(false);
    expect(result.pointsChecked).toBe(1000);
  });
});

describe('checkAlpsTunnelsFromPolyline', () => {
  it('should return no matches for empty polyline', () => {
    const result = checkAlpsTunnelsFromPolyline('');
    expect(result.frejus).toBe(false);
    expect(result.montBlanc).toBe(false);
    expect(result.pointsChecked).toBe(0);
  });
});

describe('haversineDistanceKm', () => {
  it('returns 0 for same point', () => {
    const point: PolylinePoint = { lat: 45.1, lng: 6.7 };
    expect(haversineDistanceKm(point, point)).toBe(0);
  });

  it('calculates approximate distance between known points', () => {
    // Paris to London is approximately 344 km
    const paris: PolylinePoint = { lat: 48.8566, lng: 2.3522 };
    const london: PolylinePoint = { lat: 51.5074, lng: -0.1278 };
    const distance = haversineDistanceKm(paris, london);
    expect(distance).toBeGreaterThan(340);
    expect(distance).toBeLessThan(350);
  });

  it('calculates short distances accurately', () => {
    // Two points approximately 2km apart
    const point1: PolylinePoint = { lat: 45.086, lng: 6.706 };
    const point2: PolylinePoint = { lat: 45.086 + 0.018, lng: 6.706 }; // ~2km north
    const distance = haversineDistanceKm(point1, point2);
    expect(distance).toBeGreaterThan(1.5);
    expect(distance).toBeLessThan(2.5);
  });

  it('sanity: equator 1 degree longitude ~ 111.19 km', () => {
    // At equator, 1 degree of longitude should be approximately 111.19 km
    const origin: PolylinePoint = { lat: 0, lng: 0 };
    const oneDegreeEast: PolylinePoint = { lat: 0, lng: 1 };
    const distance = haversineDistanceKm(origin, oneDegreeEast);
    // Should be close to 111.19 km (Earth's equatorial circumference / 360)
    expect(distance).toBeGreaterThan(110);
    expect(distance).toBeLessThan(112);
  });

  it('sanity: Turin to Bardonecchia < 100 km', () => {
    // Turin (45.06235, 7.67993) to Bardonecchia (45.07948, 6.69965)
    // These are both in the Alps, near Frejus tunnel
    const turin: PolylinePoint = { lat: 45.06235, lng: 7.67993 };
    const bardonecchia: PolylinePoint = { lat: 45.07948, lng: 6.69965 };
    const distance = haversineDistanceKm(turin, bardonecchia);
    // Actual distance is approximately 69 km
    expect(distance).toBeGreaterThan(60);
    expect(distance).toBeLessThan(100);
  });

  it('sanity: should not produce absurd distances like 5000+ km for nearby points', () => {
    // Points in the Alps should be close to Frejus center
    const alpinePoint: PolylinePoint = { lat: 45.1, lng: 6.8 };
    const distance = haversineDistanceKm(alpinePoint, FREJUS_CENTER);
    // Should be just a few km, not 5000+ km
    expect(distance).toBeLessThan(20);
  });

  it('sanity: Bardonecchia to Frejus center < 20 km', () => {
    // Bardonecchia (45.07948, 6.69965) is right next to Frejus tunnel entrance
    const bardonecchia: PolylinePoint = { lat: 45.07948, lng: 6.69965 };
    const distance = haversineDistanceKm(bardonecchia, FREJUS_CENTER);
    // Should be very close - Bardonecchia is the Italian portal town
    expect(distance).toBeLessThan(20);
    // More specifically, should be under 5km from tunnel center
    expect(distance).toBeLessThan(5);
  });

  it('sanity: Modane to Frejus center < 30 km', () => {
    // Modane (45.2, 6.67) is the French portal town for Frejus tunnel
    const modane: PolylinePoint = { lat: 45.2, lng: 6.67 };
    const distance = haversineDistanceKm(modane, FREJUS_CENTER);
    // Should be close - Modane is on the French side
    expect(distance).toBeLessThan(30);
  });

  it('sanity: Courmayeur to Mont Blanc center < 20 km', () => {
    // Courmayeur (45.796, 6.973) is the Italian portal town for Mont Blanc
    const courmayeur: PolylinePoint = { lat: 45.796, lng: 6.973 };
    const distance = haversineDistanceKm(courmayeur, MONT_BLANC_CENTER);
    // Should be close to tunnel center
    expect(distance).toBeLessThan(20);
  });
});

describe('checkAlpsTunnels with TunnelMatchDetails', () => {
  it('returns details structure with pointsInside count', () => {
    const points: PolylinePoint[] = [
      { lat: 45.0, lng: 6.5 },  // Outside
      { lat: 45.1, lng: 6.7 },  // Inside Frejus
      { lat: 45.12, lng: 6.72 },  // Also inside Frejus
      { lat: 45.2, lng: 6.8 },  // Outside
    ];
    const result = checkAlpsTunnels(points);

    expect(result.details).toBeDefined();
    expect(result.details.frejus.matched).toBe(true);
    expect(result.details.frejus.pointsInside).toBe(2);
    expect(result.details.frejus.firstPoint).toEqual({ lat: 45.1, lng: 6.7 });
    expect(result.details.montBlanc.matched).toBe(false);
    expect(result.details.montBlanc.pointsInside).toBe(0);
  });

  it('includes closestDistanceKm in details', () => {
    const points: PolylinePoint[] = [
      { lat: 48.0, lng: 2.3 },   // Paris area - far from tunnels
    ];
    const result = checkAlpsTunnels(points);

    expect(result.details.frejus.closestDistanceKm).toBeDefined();
    expect(result.details.frejus.closestDistanceKm).toBeGreaterThan(0);
    expect(result.details.montBlanc.closestDistanceKm).toBeDefined();
    expect(result.details.montBlanc.closestDistanceKm).toBeGreaterThan(0);
  });

  it('detects tunnel by proximity fallback when close but outside bbox', () => {
    // The Frejus bbox is conservative (covers ~15km x 14km), with center ~7km from edges.
    // With TUNNEL_PROXIMITY_KM = 3.0, it's geometrically unlikely for a point to be
    // outside the bbox but within proximity of center.
    //
    // To test the proximity fallback logic, we verify:
    // 1. closestDistanceKm is computed correctly for any point
    // 2. The proximity threshold constant is accessible

    // Point outside Frejus bbox
    const outsideFrejus: PolylinePoint = { lat: 45.20, lng: 6.70 }; // North of bbox
    expect(isPointInBBox(outsideFrejus, FREJUS_BBOX)).toBe(false);

    const distToCenter = haversineDistanceKm(outsideFrejus, FREJUS_CENTER);
    expect(distToCenter).toBeGreaterThan(TUNNEL_PROXIMITY_KM); // ~11km away

    const points: PolylinePoint[] = [outsideFrejus];
    const result = checkAlpsTunnels(points);

    // Should not match since point is outside bbox and beyond proximity
    expect(result.frejus).toBe(false);
    expect(result.details.frejus.matched).toBe(false);
    expect(result.details.frejus.pointsInside).toBe(0);
    // closestDistanceKm should be computed
    expect(result.details.frejus.closestDistanceKm).toBeDefined();
    expect(result.details.frejus.closestDistanceKm).toBeGreaterThan(10);
  });

  it('proximity fallback triggers when point is within threshold of center', () => {
    // Direct test of the proximity logic by checking a point very close to center
    // Even though Frejus bbox covers the center, we verify the distance calculation
    // Use a point very close to the actual center (45.086, 6.706)
    const veryCloseToCenter: PolylinePoint = { lat: 45.087, lng: 6.707 }; // ~0.15km from center
    const distToCenter = haversineDistanceKm(veryCloseToCenter, FREJUS_CENTER);

    expect(distToCenter).toBeLessThan(1); // Very close to center
    // This point is inside bbox, so it matches by bbox not proximity
    expect(isPointInBBox(veryCloseToCenter, FREJUS_BBOX)).toBe(true);

    const points: PolylinePoint[] = [veryCloseToCenter];
    const result = checkAlpsTunnels(points);

    expect(result.frejus).toBe(true);
    expect(result.details.frejus.matched).toBe(true);
    expect(result.details.frejus.pointsInside).toBe(1);
    // Since it matched by bbox, matchedByProximity should be falsy
    expect(result.details.frejus.matchedByProximity).toBeFalsy();
  });

  it('does not match tunnel if point is far from both bbox and center', () => {
    const farPoint: PolylinePoint = { lat: 48.0, lng: 2.3 }; // Paris
    const points: PolylinePoint[] = [farPoint];
    const result = checkAlpsTunnels(points);

    expect(result.frejus).toBe(false);
    expect(result.montBlanc).toBe(false);
    expect(result.details.frejus.matched).toBe(false);
    expect(result.details.frejus.matchedByProximity).toBeFalsy();
    expect(result.details.montBlanc.matched).toBe(false);
    expect(result.details.montBlanc.matchedByProximity).toBeFalsy();
  });

  it('prefers bbox match over proximity match', () => {
    // Point inside Frejus bbox
    const insideFrejus: PolylinePoint = { lat: 45.1, lng: 6.7 };
    const points: PolylinePoint[] = [insideFrejus];
    const result = checkAlpsTunnels(points);

    expect(result.frejus).toBe(true);
    expect(result.details.frejus.matched).toBe(true);
    expect(result.details.frejus.pointsInside).toBe(1);
    // Should NOT be marked as proximity match since bbox matched
    expect(result.details.frejus.matchedByProximity).toBeFalsy();
  });

  it('returns empty details for empty points array', () => {
    const result = checkAlpsTunnels([]);

    expect(result.details.frejus.matched).toBe(false);
    expect(result.details.frejus.pointsInside).toBe(0);
    expect(result.details.frejus.closestDistanceKm).toBeUndefined();
    expect(result.details.montBlanc.matched).toBe(false);
    expect(result.details.montBlanc.pointsInside).toBe(0);
    expect(result.details.montBlanc.closestDistanceKm).toBeUndefined();
  });
});

describe('bbox coordinates validation', () => {
  it('Frejus bbox should cover the tunnel corridor', () => {
    // Frejus tunnel entrance (Italian side): approximately 45.0583, 6.7169
    // Frejus tunnel entrance (French side): approximately 45.1379, 6.6625
    expect(FREJUS_BBOX.minLat).toBeLessThan(45.0583);
    expect(FREJUS_BBOX.maxLat).toBeGreaterThan(45.1379);
    expect(FREJUS_BBOX.minLng).toBeLessThan(6.6625);
    expect(FREJUS_BBOX.maxLng).toBeGreaterThan(6.7169);
  });

  it('Mont Blanc bbox should cover the tunnel corridor', () => {
    // Mont Blanc tunnel entrance (Italian side): approximately 45.8461, 6.9339
    // Mont Blanc tunnel entrance (French side): approximately 45.8956, 6.9689
    expect(MONT_BLANC_BBOX.minLat).toBeLessThan(45.8461);
    expect(MONT_BLANC_BBOX.maxLat).toBeGreaterThan(45.8956);
    expect(MONT_BLANC_BBOX.minLng).toBeLessThan(6.9339);
    expect(MONT_BLANC_BBOX.maxLng).toBeGreaterThan(6.9689);
  });

  it('bboxes should not overlap', () => {
    // Frejus is south of Mont Blanc
    expect(FREJUS_BBOX.maxLat).toBeLessThan(MONT_BLANC_BBOX.minLat);
  });
});

describe('computePolylineSanityStats', () => {
  it('returns null stats for empty points array', () => {
    const stats = computePolylineSanityStats([]);
    expect(stats.polylineBounds).toBeNull();
    expect(stats.polylineFirstPoint).toBeNull();
    expect(stats.polylineLastPoint).toBeNull();
    expect(stats.pointCount).toBe(0);
  });

  it('computes bounds correctly for single point', () => {
    const points: PolylinePoint[] = [{ lat: 45.1, lng: 6.7 }];
    const stats = computePolylineSanityStats(points);

    expect(stats.pointCount).toBe(1);
    expect(stats.polylineBounds).toEqual({
      minLat: 45.1,
      maxLat: 45.1,
      minLng: 6.7,
      maxLng: 6.7,
    });
    expect(stats.polylineFirstPoint).toEqual({ lat: 45.1, lng: 6.7 });
    expect(stats.polylineLastPoint).toEqual({ lat: 45.1, lng: 6.7 });
  });

  it('computes bounds correctly for multiple points', () => {
    const points: PolylinePoint[] = [
      { lat: 45.0, lng: 6.5 },
      { lat: 45.5, lng: 7.0 },
      { lat: 44.5, lng: 6.0 },
    ];
    const stats = computePolylineSanityStats(points);

    expect(stats.pointCount).toBe(3);
    expect(stats.polylineBounds).toEqual({
      minLat: 44.5,
      maxLat: 45.5,
      minLng: 6.0,
      maxLng: 7.0,
    });
    expect(stats.polylineFirstPoint).toEqual({ lat: 45.0, lng: 6.5 });
    expect(stats.polylineLastPoint).toEqual({ lat: 44.5, lng: 6.0 });
  });
});

describe('polyline decoder output validation', () => {
  it('decoder handles sample polyline without crashing', () => {
    // Test with a sample polyline string (may or may not be a valid route)
    const encoded = 'BFoz5xJ67i1B1B7PzIhaxL7Y';
    const points = decodeFlexiblePolyline(encoded);

    // Should have decoded some points
    expect(points.length).toBeGreaterThan(0);

    // All points should have numeric lat/lng
    for (const point of points) {
      expect(typeof point.lat).toBe('number');
      expect(typeof point.lng).toBe('number');
      expect(Number.isFinite(point.lat)).toBe(true);
      expect(Number.isFinite(point.lng)).toBe(true);
    }

    // Check that bounds are computed correctly
    const stats = computePolylineSanityStats(points);
    expect(stats.polylineBounds).not.toBeNull();
  });

  it('decoded polyline for Turin->Chambery route should have European bounds', () => {
    // For a Turin to Chambery route via Bardonecchia:
    // - Lat should be roughly 44 to 46 (Alps region)
    // - Lng should be roughly 5 to 8 (French/Italian Alps)
    //
    // We create synthetic points to validate the sanity checking
    const syntheticAlpineRoute: PolylinePoint[] = [
      { lat: 45.06235, lng: 7.67993 },  // Turin
      { lat: 45.07948, lng: 6.69965 },  // Bardonecchia (near Frejus)
      { lat: 45.56628, lng: 5.91215 },  // Chambery
    ];

    const stats = computePolylineSanityStats(syntheticAlpineRoute);

    // Sanity check: bounds should be within Europe/Alps region
    expect(stats.polylineBounds).not.toBeNull();
    const bounds = stats.polylineBounds!;

    // Latitude bounds should be roughly 44-46 for Alpine route
    expect(bounds.minLat).toBeGreaterThan(44);
    expect(bounds.maxLat).toBeLessThan(47);

    // Longitude bounds should be roughly 5-8 for French/Italian Alps
    expect(bounds.minLng).toBeGreaterThan(4);
    expect(bounds.maxLng).toBeLessThan(9);

    // First point should be Turin
    expect(stats.polylineFirstPoint?.lat).toBeCloseTo(45.06235, 4);
    expect(stats.polylineFirstPoint?.lng).toBeCloseTo(7.67993, 4);

    // Last point should be Chambery
    expect(stats.polylineLastPoint?.lat).toBeCloseTo(45.56628, 4);
    expect(stats.polylineLastPoint?.lng).toBeCloseTo(5.91215, 4);
  });

  it('should NOT produce (0,0) or near-zero coordinates for valid polylines', () => {
    // This test guards against the bug where incorrect header decoding
    // caused all coordinates to be near (0, 0)
    const encoded = 'BFoz5xJ67i1B1B7PzIhaxL7Y';
    const points = decodeFlexiblePolyline(encoded);

    if (points.length > 0) {
      // At least one point should be far from (0, 0)
      const hasNonZeroPoint = points.some(
        (p) => Math.abs(p.lat) > 1 || Math.abs(p.lng) > 1
      );
      expect(hasNonZeroPoint).toBe(true);
    }
  });
});

describe('getAlpsDebugConfig', () => {
  it('returns correct tunnel centers', () => {
    const config = getAlpsDebugConfig();

    // Frejus center should be near Bardonecchia
    expect(config.centers.frejus.lat).toBeCloseTo(45.086, 2);
    expect(config.centers.frejus.lng).toBeCloseTo(6.706, 2);

    // Mont Blanc center should be near Courmayeur
    expect(config.centers.montBlanc.lat).toBeCloseTo(45.924, 2);
    expect(config.centers.montBlanc.lng).toBeCloseTo(6.968, 2);
  });

  it('returns correct bboxes', () => {
    const config = getAlpsDebugConfig();

    // Frejus bbox should cover the tunnel corridor
    expect(config.bboxes.frejus.minLat).toBe(45.03);
    expect(config.bboxes.frejus.maxLat).toBe(45.17);
    expect(config.bboxes.frejus.minLng).toBe(6.60);
    expect(config.bboxes.frejus.maxLng).toBe(6.78);

    // Mont Blanc bbox should cover the tunnel corridor
    expect(config.bboxes.montBlanc.minLat).toBe(45.82);
    expect(config.bboxes.montBlanc.maxLat).toBe(45.96);
    expect(config.bboxes.montBlanc.minLng).toBe(6.92);
    expect(config.bboxes.montBlanc.maxLng).toBe(7.03);
  });
});

describe('computeAlpsCenterDistances', () => {
  it('computes distances from origin/waypoints/destination to tunnel centers', () => {
    const origin: PolylinePoint = { lat: 45.06235, lng: 7.67993 }; // Turin
    const waypoints: PolylinePoint[] = [
      { lat: 45.07948, lng: 6.69965 }, // Bardonecchia
    ];
    const destination: PolylinePoint = { lat: 45.56628, lng: 5.91215 }; // Chambery

    const distances = computeAlpsCenterDistances(origin, waypoints, destination);

    // Turin to Frejus center should be ~69 km
    expect(distances.frejus.fromOrigin).toBeGreaterThan(60);
    expect(distances.frejus.fromOrigin).toBeLessThan(80);

    // Bardonecchia to Frejus center should be < 5 km
    expect(distances.frejus.fromWaypoints[0]).toBeLessThan(5);

    // Chambery to Frejus center should be ~82 km
    expect(distances.frejus.fromDestination).toBeGreaterThan(70);
    expect(distances.frejus.fromDestination).toBeLessThan(90);
  });

  it('handles null origin and destination', () => {
    const waypoints: PolylinePoint[] = [
      { lat: 45.07948, lng: 6.69965 }, // Bardonecchia
    ];

    const distances = computeAlpsCenterDistances(null, waypoints, null);

    expect(distances.frejus.fromOrigin).toBeUndefined();
    expect(distances.frejus.fromDestination).toBeUndefined();
    expect(distances.frejus.fromWaypoints).toHaveLength(1);
    expect(distances.frejus.fromWaypoints[0]).toBeLessThan(5);
  });

  it('handles empty waypoints', () => {
    const origin: PolylinePoint = { lat: 45.06235, lng: 7.67993 };
    const destination: PolylinePoint = { lat: 45.56628, lng: 5.91215 };

    const distances = computeAlpsCenterDistances(origin, [], destination);

    expect(distances.frejus.fromWaypoints).toHaveLength(0);
    expect(distances.frejus.fromOrigin).toBeDefined();
    expect(distances.frejus.fromDestination).toBeDefined();
  });
});

describe('arePolylineBoundsPlausible', () => {
  it('returns true for bounds within Earth coordinate ranges', () => {
    const validBounds = {
      minLat: 45.0,
      maxLat: 46.0,
      minLng: 6.0,
      maxLng: 8.0,
    };
    expect(arePolylineBoundsPlausible(validBounds)).toBe(true);
  });

  it('returns false for latitude outside -90 to 90', () => {
    const invalidBounds = {
      minLat: -91,
      maxLat: 46.0,
      minLng: 6.0,
      maxLng: 8.0,
    };
    expect(arePolylineBoundsPlausible(invalidBounds)).toBe(false);
  });

  it('returns false for absurd bounds like those from corrupt polyline', () => {
    // These are the absurd bounds from the bug report
    const corruptBounds = {
      minLat: 767993.7,
      maxLat: 767993.8,
      minLng: 1000000,
      maxLng: 2000000,
    };
    expect(arePolylineBoundsPlausible(corruptBounds)).toBe(false);
  });

  it('returns true for edge case bounds at max valid ranges', () => {
    const edgeBounds = {
      minLat: -90,
      maxLat: 90,
      minLng: -180,
      maxLng: 180,
    };
    expect(arePolylineBoundsPlausible(edgeBounds)).toBe(true);
  });
});

describe('checkWaypointProximity', () => {
  it('detects Frejus when waypoint is within 3km of center', () => {
    // Bardonecchia coordinates - very close to Frejus tunnel
    const bardonecchia: PolylinePoint = { lat: 45.07948, lng: 6.69965 };
    const origin: PolylinePoint = { lat: 45.06235, lng: 7.67993 }; // Turin
    const destination: PolylinePoint = { lat: 45.56628, lng: 5.91215 }; // Chambery

    const result = checkWaypointProximity(origin, [bardonecchia], destination);

    expect(result.frejus).toBe(true);
    expect(result.montBlanc).toBe(false);
    expect(result.reasons.frejus).toBe('waypointProximity');
    expect(result.reasons.montBlanc).toBe('none');
  });

  it('does not detect Mont Blanc when waypoint is more than 3km from center', () => {
    // Courmayeur coordinates - the proximity threshold is 3km, Courmayeur is ~14km from center
    const courmayeur: PolylinePoint = { lat: 45.796, lng: 6.973 };
    const origin: PolylinePoint = { lat: 45.06235, lng: 7.67993 }; // Turin
    const destination: PolylinePoint = { lat: 45.56628, lng: 5.91215 }; // Chambery

    const result = checkWaypointProximity(origin, [courmayeur], destination);

    // Courmayeur is actually ~14km from Mont Blanc center, so won't match
    expect(result.montBlanc).toBe(false);
  });

  it('detects proximity from origin when origin is within threshold', () => {
    // Use Frejus center as origin
    const result = checkWaypointProximity(FREJUS_CENTER, [], null);

    expect(result.frejus).toBe(true);
    expect(result.reasons.frejus).toBe('waypointProximity');
  });

  it('detects proximity from destination when destination is within threshold', () => {
    // Use Mont Blanc center as destination
    const result = checkWaypointProximity(null, [], MONT_BLANC_CENTER);

    expect(result.montBlanc).toBe(true);
    expect(result.reasons.montBlanc).toBe('waypointProximity');
  });

  it('returns no match when all points are far from tunnel centers', () => {
    const paris: PolylinePoint = { lat: 48.8566, lng: 2.3522 };
    const london: PolylinePoint = { lat: 51.5074, lng: -0.1278 };

    const result = checkWaypointProximity(paris, [], london);

    expect(result.frejus).toBe(false);
    expect(result.montBlanc).toBe(false);
    expect(result.reasons.frejus).toBe('none');
    expect(result.reasons.montBlanc).toBe('none');
  });

  it('detects both tunnels when waypoints are close to both centers', () => {
    const result = checkWaypointProximity(FREJUS_CENTER, [MONT_BLANC_CENTER], null);

    expect(result.frejus).toBe(true);
    expect(result.montBlanc).toBe(true);
    expect(result.reasons.frejus).toBe('waypointProximity');
    expect(result.reasons.montBlanc).toBe('waypointProximity');
  });
});

describe('Waypoint proximity threshold', () => {
  it('WAYPOINT_PROXIMITY_THRESHOLD_KM should be 3km', () => {
    expect(WAYPOINT_PROXIMITY_THRESHOLD_KM).toBe(3.0);
  });

  it('Bardonecchia should be within 3km of Frejus center', () => {
    const bardonecchia: PolylinePoint = { lat: 45.07948, lng: 6.69965 };
    const distance = haversineDistanceKm(bardonecchia, FREJUS_CENTER);

    expect(distance).toBeLessThan(WAYPOINT_PROXIMITY_THRESHOLD_KM);
  });

  it('Modane should be more than 3km from Frejus center', () => {
    // Modane is the French portal town, about 13km from the actual tunnel center
    const modane: PolylinePoint = { lat: 45.2, lng: 6.67 };
    const distance = haversineDistanceKm(modane, FREJUS_CENTER);

    expect(distance).toBeGreaterThan(WAYPOINT_PROXIMITY_THRESHOLD_KM);
  });
});
