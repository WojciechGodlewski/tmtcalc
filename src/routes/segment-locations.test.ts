import { describe, it, expect, vi } from 'vitest';
import { enrichRestrictionSegmentsWithLocations, MAX_LOOKUPS_PER_REQUEST } from './segment-locations.js';
import type { RestrictionSegment } from '../types/route-facts.js';

function makeSegment(overrides: Partial<RestrictionSegment> = {}): RestrictionSegment {
  return {
    code: 'violatedVehicleRestriction',
    severity: 'critical',
    title: 'Violated vehicle restriction.',
    sectionIndex: 0,
    noticeIndex: 0,
    spanStartOffset: 2,
    spanEndOffset: 3,
    startPoint: { lat: 46.5, lng: 11.35 },
    endPoint: { lat: 47.27, lng: 11.4 },
    approxDistanceFromOriginKm: 121.8,
    details: [],
    restrictionSummary: 'Maximum gross weight: 9000 kg',
    ...overrides,
  };
}

const REVERSE_RESULT = {
  label: 'Brennero, Trentino-South Tyrol, Italy',
  countryCode: 'ITA',
  city: 'Brennero',
  district: null,
  county: 'Bolzano',
  state: 'Trentino-South Tyrol',
  street: 'A22',
};

describe('enrichRestrictionSegmentsWithLocations', () => {
  it('attaches midPoint and location from reverse geocoding', async () => {
    const reverseGeocode = vi.fn().mockResolvedValue(REVERSE_RESULT);
    const segment = makeSegment();

    const stats = await enrichRestrictionSegmentsWithLocations(reverseGeocode, [segment]);

    // Midpoint of start/end
    expect(segment.midPoint).toEqual({ lat: 46.885, lng: 11.375 });
    expect(reverseGeocode).toHaveBeenCalledWith(46.885, 11.375);

    expect(segment.location).toEqual({
      label: 'Brennero, Trentino-South Tyrol, Italy',
      city: 'Brennero',
      district: null,
      county: 'Bolzano',
      state: 'Trentino-South Tyrol',
      countryCode: 'ITA',
      street: 'A22',
      source: 'here_reverse_geocode',
    });
    expect(stats).toEqual({ attempted: 1, succeeded: 1, failed: 0, skipped: 0 });
  });

  it('composes a fallback label from components when HERE label is empty', async () => {
    const reverseGeocode = vi.fn().mockResolvedValue({
      label: '',
      city: 'Modane',
      state: 'Savoie',
      countryCode: 'FRA',
    });
    const segment = makeSegment();
    await enrichRestrictionSegmentsWithLocations(reverseGeocode, [segment]);
    expect(segment.location?.label).toBe('Modane, Savoie, FRA');
  });

  it('never throws when reverse geocoding fails; segment keeps location=null', async () => {
    const reverseGeocode = vi.fn().mockRejectedValue(new Error('HERE API error: 500 apiKey=secret'));
    const segment = makeSegment();

    const stats = await enrichRestrictionSegmentsWithLocations(reverseGeocode, [segment]);

    expect(segment.location).toBeNull();
    expect(segment.midPoint).not.toBeNull();
    expect(stats).toEqual({ attempted: 1, succeeded: 0, failed: 1, skipped: 0 });
  });

  it('caps lookups at 5 segments per request; the rest get location=null', async () => {
    const reverseGeocode = vi.fn().mockResolvedValue(REVERSE_RESULT);
    // 7 segments with DISTINCT midpoints
    const segments = Array.from({ length: 7 }, (_, i) =>
      makeSegment({
        startPoint: { lat: 46 + i, lng: 11 },
        endPoint: { lat: 46 + i + 0.1, lng: 11.1 },
      })
    );

    const stats = await enrichRestrictionSegmentsWithLocations(reverseGeocode, segments);

    expect(reverseGeocode).toHaveBeenCalledTimes(MAX_LOOKUPS_PER_REQUEST);
    expect(segments.slice(0, 5).every((s) => s.location !== null)).toBe(true);
    expect(segments.slice(5).every((s) => s.location === null)).toBe(true);
    expect(stats.attempted).toBe(5);
    expect(stats.succeeded).toBe(5);
    expect(stats.skipped).toBe(2);
  });

  it('dedupes near-identical midpoints within a request (one HERE call)', async () => {
    const reverseGeocode = vi.fn().mockResolvedValue(REVERSE_RESULT);
    // Same segment twice plus one differing only in the 5th decimal (~1 m)
    const segments = [
      makeSegment(),
      makeSegment(),
      makeSegment({
        startPoint: { lat: 46.50001, lng: 11.35001 },
        endPoint: { lat: 47.27001, lng: 11.40001 },
      }),
    ];

    const stats = await enrichRestrictionSegmentsWithLocations(reverseGeocode, segments);

    expect(reverseGeocode).toHaveBeenCalledTimes(1);
    expect(segments.every((s) => s.location?.label === REVERSE_RESULT.label)).toBe(true);
    expect(stats).toEqual({ attempted: 3, succeeded: 3, failed: 0, skipped: 0 });
  });

  it('skips segments without any coordinates', async () => {
    const reverseGeocode = vi.fn().mockResolvedValue(REVERSE_RESULT);
    const segment = makeSegment({ startPoint: null, endPoint: null });

    const stats = await enrichRestrictionSegmentsWithLocations(reverseGeocode, [segment]);

    expect(reverseGeocode).not.toHaveBeenCalled();
    expect(segment.midPoint).toBeNull();
    expect(segment.location).toBeNull();
    expect(stats).toEqual({ attempted: 0, succeeded: 0, failed: 0, skipped: 1 });
  });

  it('uses the single available endpoint when only one exists', async () => {
    const reverseGeocode = vi.fn().mockResolvedValue(REVERSE_RESULT);
    const segment = makeSegment({ endPoint: null });

    await enrichRestrictionSegmentsWithLocations(reverseGeocode, [segment]);

    expect(segment.midPoint).toEqual({ lat: 46.5, lng: 11.35 });
    expect(reverseGeocode).toHaveBeenCalledWith(46.5, 11.35);
  });

  it('treats an empty reverse geocode result as failed (location=null)', async () => {
    const reverseGeocode = vi.fn().mockResolvedValue({ label: '', countryCode: null });
    const segment = makeSegment();

    const stats = await enrichRestrictionSegmentsWithLocations(reverseGeocode, [segment]);

    expect(segment.location).toBeNull();
    expect(stats).toEqual({ attempted: 1, succeeded: 0, failed: 1, skipped: 0 });
  });
});
