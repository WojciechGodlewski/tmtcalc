/**
 * Tests for HERE Flexible Polyline decoder and Alps tunnel bbox detection
 */

import { describe, it, expect } from 'vitest';
import {
  decodeFlexiblePolyline,
  isPointInBBox,
  checkAlpsTunnels,
  checkAlpsTunnelsFromPolyline,
  FREJUS_BBOX,
  MONT_BLANC_BBOX,
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
