import { describe, it, expect } from 'vitest';
import {
  addPoint,
  removePoint,
  undoLastPoint,
  clearPoints,
  pointRole,
  derivePayloadLocations,
  canAddPoint,
  MAX_ROUTE_POINTS,
} from './route-points.js';

const P = (lat: number, lng: number) => ({ lat, lng });

describe('route points state', () => {
  it('appends points and rounds to 5 decimals', () => {
    const points = addPoint([], P(45.062355678, 7.679935123));
    expect(points).toEqual([{ lat: 45.06236, lng: 7.67994 }]);
  });

  it('ignores non-finite coordinates', () => {
    expect(addPoint([], P(NaN, 7))).toEqual([]);
    expect(addPoint([], P(45, Infinity))).toEqual([]);
  });

  it('caps the number of points', () => {
    let points = [] as ReturnType<typeof clearPoints>;
    for (let i = 0; i < MAX_ROUTE_POINTS + 3; i++) {
      points = addPoint(points, P(45 + i * 0.1, 7));
    }
    expect(points).toHaveLength(MAX_ROUTE_POINTS);
    expect(canAddPoint(points)).toBe(false);
  });

  it('latest click is always the destination (rolling)', () => {
    let points = addPoint([], P(45, 7)); // origin
    points = addPoint(points, P(46, 8)); // destination
    points = addPoint(points, P(47, 9)); // new destination, previous rolls to via

    const payload = derivePayloadLocations(points)!;
    expect(payload.origin).toEqual(P(45, 7));
    expect(payload.via).toEqual([P(46, 8)]);
    expect(payload.destination).toEqual(P(47, 9));
  });

  it('derives roles: A for first, B for last, numbers between', () => {
    const points = [P(1, 1), P(2, 2), P(3, 3), P(4, 4)];
    expect(pointRole(points, 0)).toBe('A');
    expect(pointRole(points, 1)).toBe('1');
    expect(pointRole(points, 2)).toBe('2');
    expect(pointRole(points, 3)).toBe('B');
  });

  it('returns null payload below two points', () => {
    expect(derivePayloadLocations([])).toBeNull();
    expect(derivePayloadLocations([P(45, 7)])).toBeNull();
  });

  it('two points produce origin/destination with empty via', () => {
    const payload = derivePayloadLocations([P(45, 7), P(46, 8)])!;
    expect(payload.via).toEqual([]);
  });

  it('removing a point re-derives roles (removed via, removed endpoint)', () => {
    const points = [P(1, 1), P(2, 2), P(3, 3)];
    // Remove the via -> straight A->B
    expect(derivePayloadLocations(removePoint(points, 1))!.via).toEqual([]);
    // Remove the destination -> previous via becomes destination
    const withoutDest = removePoint(points, 2);
    const payload = derivePayloadLocations(withoutDest)!;
    expect(payload.destination).toEqual(P(2, 2));
    // Remove the origin -> via becomes origin
    const withoutOrigin = removePoint(points, 0);
    expect(derivePayloadLocations(withoutOrigin)!.origin).toEqual(P(2, 2));
  });

  it('removePoint ignores out-of-range indexes', () => {
    const points = [P(1, 1)];
    expect(removePoint(points, -1)).toBe(points);
    expect(removePoint(points, 5)).toBe(points);
  });

  it('undoLastPoint drops the destination', () => {
    const points = [P(1, 1), P(2, 2), P(3, 3)];
    expect(undoLastPoint(points)).toEqual([P(1, 1), P(2, 2)]);
    expect(undoLastPoint([])).toEqual([]);
  });

  it('clearPoints empties the plan', () => {
    expect(clearPoints()).toEqual([]);
  });
});
