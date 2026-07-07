import { describe, it, expect } from 'vitest';
import {
  emptyStops,
  addressStops,
  addPointStop,
  updateAddressStop,
  addEmptyStop,
  removeStop,
  stopRole,
  filledStops,
  derivePayloadLocations,
  planningMarkers,
  canAcceptPoint,
  MAX_STOPS,
  type Stop,
} from './route-stops.js';

const A = (address: string): Stop => ({ kind: 'address', address });
const P = (lat: number, lng: number): Stop => ({ kind: 'point', lat, lng });

describe('unified route stops', () => {
  it('starts with two empty address rows', () => {
    expect(emptyStops()).toEqual([A(''), A('')]);
  });

  it('map click fills the first empty row before appending', () => {
    let stops = emptyStops();
    stops = addPointStop(stops, { lat: 45.1, lng: 7.1 });
    expect(stops).toEqual([P(45.1, 7.1), A('')]);
    stops = addPointStop(stops, { lat: 46.2, lng: 8.2 });
    expect(stops).toEqual([P(45.1, 7.1), P(46.2, 8.2)]);
    // No empty rows left -> append; latest click becomes the destination
    stops = addPointStop(stops, { lat: 47.3, lng: 9.3 });
    expect(stops).toHaveLength(3);
    expect(stops[2]).toEqual(P(47.3, 9.3));
  });

  it('fills an empty destination row after a typed origin (click = destination)', () => {
    let stops: Stop[] = [A('Poznań, Poland'), A('')];
    stops = addPointStop(stops, { lat: 45.4384, lng: 10.9916 });
    const payload = derivePayloadLocations(stops)!;
    expect(payload.origin).toEqual({ address: 'Poznań, Poland' });
    expect(payload.destination).toEqual({ lat: 45.4384, lng: 10.9916 });
    expect(payload.via).toEqual([]);
  });

  it('mixes address and point stops in one payload with vias in order', () => {
    const stops: Stop[] = [A('Turin, Italy'), P(45.0787, 6.704), A('Modane, France'), P(45.5646, 5.9178)];
    const payload = derivePayloadLocations(stops)!;
    expect(payload.origin).toEqual({ address: 'Turin, Italy' });
    expect(payload.via).toEqual([{ lat: 45.0787, lng: 6.704 }, { address: 'Modane, France' }]);
    expect(payload.destination).toEqual({ lat: 45.5646, lng: 5.9178 });
  });

  it('rounds clicked coordinates to 5 decimals and rejects non-finite values', () => {
    expect(addPointStop([A('')], { lat: 45.123456789, lng: 7.987654321 })[0]).toEqual(P(45.12346, 7.98765));
    expect(addPointStop([A('')], { lat: NaN, lng: 7 })).toEqual([A('')]);
  });

  it('ignores empty rows in payload and roles', () => {
    const stops: Stop[] = [A(''), A('Verona, Italy'), A('  '), P(48.14, 11.58)];
    expect(filledStops(stops)).toHaveLength(2);
    const payload = derivePayloadLocations(stops)!;
    expect(payload.origin).toEqual({ address: 'Verona, Italy' });
    expect(payload.destination).toEqual({ lat: 48.14, lng: 11.58 });
    expect(stopRole(stops, 0)).toBe('·');
    expect(stopRole(stops, 1)).toBe('A');
    expect(stopRole(stops, 2)).toBe('·');
    expect(stopRole(stops, 3)).toBe('B');
  });

  it('hints A/B roles on empty rows when nothing is filled yet', () => {
    const stops = emptyStops();
    expect(stopRole(stops, 0)).toBe('A');
    expect(stopRole(stops, 1)).toBe('B');
    const three = addEmptyStop(stops);
    expect(stopRole(three, 1)).toBe('·');
    expect(stopRole(three, 2)).toBe('B');
  });

  it('derives roles A/1/2/B across filled stops', () => {
    const stops: Stop[] = [A('a'), P(1, 1), P(2, 2), A('b')];
    expect(['A', '1', '2', 'B']).toEqual(stops.map((_, i) => stopRole(stops, i)));
  });

  it('returns null payload below two filled stops', () => {
    expect(derivePayloadLocations(emptyStops())).toBeNull();
    expect(derivePayloadLocations([A('Only origin'), A('')])).toBeNull();
  });

  it('caps stops and reports acceptance correctly', () => {
    let stops: Stop[] = [];
    for (let i = 0; i < MAX_STOPS + 3; i++) stops = addPointStop(stops, { lat: 40 + i, lng: 7 });
    expect(stops).toHaveLength(MAX_STOPS);
    expect(canAcceptPoint(stops)).toBe(false);
    expect(addEmptyStop(stops)).toHaveLength(MAX_STOPS);
    // An empty row makes a click acceptable even at max length
    const withEmpty = [...stops.slice(0, MAX_STOPS - 1), A('')];
    expect(canAcceptPoint(withEmpty)).toBe(true);
  });

  it('removeStop pads back to two rows', () => {
    const stops = removeStop([P(1, 1), P(2, 2)], 0);
    expect(stops).toEqual([P(2, 2), A('')]);
    expect(removeStop([P(1, 1), A('')], 0)).toEqual([A(''), A('')]);
    const untouched = [P(1, 1), P(2, 2)];
    expect(removeStop(untouched, 9)).toBe(untouched);
  });

  it('updateAddressStop converts a point row back to an address row', () => {
    const stops = updateAddressStop([P(1, 1), A('')], 0, 'Verona, Italy');
    expect(stops[0]).toEqual(A('Verona, Italy'));
  });

  it('planningMarkers returns only point stops with their roles', () => {
    const stops: Stop[] = [A('Turin, Italy'), P(45.1, 7.1), A(''), P(45.2, 7.2)];
    expect(planningMarkers(stops)).toEqual([
      { lat: 45.1, lng: 7.1, role: '1' },
      { lat: 45.2, lng: 7.2, role: 'B' },
    ]);
  });

  it('preset helper builds address stops', () => {
    expect(addressStops(['Turin, Italy', 'Chambéry, France'])).toEqual([
      A('Turin, Italy'),
      A('Chambéry, France'),
    ]);
  });
});
