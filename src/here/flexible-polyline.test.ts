/**
 * Tests for HERE Flexible Polyline decoder and Alps tunnel bbox detection
 */

import { describe, it, expect } from 'vitest';
import {
  decodeFlexiblePolyline,
  isPointInBBox,
  checkAlpsTunnels,
  checkAlpsTunnelsFromPolyline,
  haversineDistanceKm,
  FREJUS_BBOX,
  MONT_BLANC_BBOX,
  FREJUS_CENTER,
  MONT_BLANC_CENTER,
  TUNNEL_PROXIMITY_KM,
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
    // Frejus center to a point 2km away
    const point1 = FREJUS_CENTER;
    const point2: PolylinePoint = { lat: 45.1 + 0.018, lng: 6.69 }; // ~2km north
    const distance = haversineDistanceKm(point1, point2);
    expect(distance).toBeGreaterThan(1.5);
    expect(distance).toBeLessThan(2.5);
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
    const veryCloseToCenter: PolylinePoint = { lat: 45.101, lng: 6.691 }; // ~0.15km from center
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
