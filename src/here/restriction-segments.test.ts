import { describe, it, expect } from 'vitest';
import { extractRestrictionSegments, buildRestrictionSummary } from './restriction-segments.js';
import { encodeFlexiblePolyline, haversineDistanceKm } from './flexible-polyline.js';
import type { HereRoutingResponse } from './route-truck.js';

// 5 points, ~roughly along a road near Munich; consecutive gaps ~1.4-1.5 km
const POINTS = [
  { lat: 48.1, lng: 11.5 },
  { lat: 48.11, lng: 11.51 },
  { lat: 48.12, lng: 11.52 },
  { lat: 48.13, lng: 11.53 },
  { lat: 48.14, lng: 11.54 },
];
const POLYLINE = encodeFlexiblePolyline(POINTS, 5);

const VIOLATED_NOTICE = {
  title: 'Violated vehicle restriction.',
  code: 'violatedVehicleRestriction',
  severity: 'critical',
  details: [{ type: 'violatedVehicleRestriction', maxGrossWeight: 9000 }],
};

function makeResponse(section: Record<string, unknown>): HereRoutingResponse {
  return {
    routes: [
      {
        id: 'r1',
        sections: [
          {
            id: 's1',
            type: 'vehicle',
            departure: { time: '', place: { type: 'place', location: { lat: 0, lng: 0 } } },
            arrival: { time: '', place: { type: 'place', location: { lat: 0, lng: 0 } } },
            summary: { duration: 3600, length: 60000, baseDuration: 3600 },
            transport: { mode: 'truck' },
            ...section,
          },
        ],
      },
    ],
  } as unknown as HereRoutingResponse;
}

describe('extractRestrictionSegments', () => {
  it('builds a segment from a span referencing a violated restriction notice', () => {
    const response = makeResponse({
      polyline: POLYLINE,
      notices: [VIOLATED_NOTICE],
      spans: [{ offset: 0 }, { offset: 2, notices: [0] }, { offset: 4 }],
    });

    const segments = extractRestrictionSegments(response);
    expect(segments).toHaveLength(1);

    const seg = segments[0];
    expect(seg.code).toBe('violatedVehicleRestriction');
    expect(seg.severity).toBe('critical');
    expect(seg.title).toBe('Violated vehicle restriction.');
    expect(seg.sectionIndex).toBe(0);
    expect(seg.noticeIndex).toBe(0);
    expect(seg.spanStartOffset).toBe(2);
    expect(seg.spanEndOffset).toBe(4);
    expect(seg.startPoint).toEqual({ lat: 48.12, lng: 11.52 });
    expect(seg.endPoint).toEqual({ lat: 48.14, lng: 11.54 });
    expect(seg.restrictionSummary).toBe('Maximum gross weight: 9000 kg');

    // Cumulative distance from route start to offset 2
    const expectedKm =
      haversineDistanceKm(POINTS[0], POINTS[1]) + haversineDistanceKm(POINTS[1], POINTS[2]);
    expect(seg.approxDistanceFromOriginKm).toBeCloseTo(Math.round(expectedKm * 10) / 10, 1);
  });

  it('extends the last referencing span to the end of the section', () => {
    const response = makeResponse({
      polyline: POLYLINE,
      notices: [VIOLATED_NOTICE],
      spans: [{ offset: 0 }, { offset: 3, notices: [0] }],
    });

    const segments = extractRestrictionSegments(response);
    expect(segments).toHaveLength(1);
    expect(segments[0].spanStartOffset).toBe(3);
    expect(segments[0].spanEndOffset).toBe(4); // last point index
    expect(segments[0].endPoint).toEqual({ lat: 48.14, lng: 11.54 });
  });

  it('merges adjacent spans referencing the same notice into one segment', () => {
    const response = makeResponse({
      polyline: POLYLINE,
      notices: [VIOLATED_NOTICE],
      spans: [
        { offset: 0, notices: [0] },
        { offset: 1, notices: [0] },
        { offset: 3 },
      ],
    });

    const segments = extractRestrictionSegments(response);
    expect(segments).toHaveLength(1);
    expect(segments[0].spanStartOffset).toBe(0);
    expect(segments[0].spanEndOffset).toBe(3);
    expect(segments[0].approxDistanceFromOriginKm).toBe(0);
  });

  it('returns no segments when spans are missing (generic warning fallback)', () => {
    const response = makeResponse({
      polyline: POLYLINE,
      notices: [VIOLATED_NOTICE],
      // no spans at all
    });
    expect(extractRestrictionSegments(response)).toHaveLength(0);
  });

  it('ignores notices with other codes', () => {
    const response = makeResponse({
      polyline: POLYLINE,
      notices: [{ title: 'Road works', code: 'roadworks', severity: 'info' }],
      spans: [{ offset: 1, notices: [0] }],
    });
    expect(extractRestrictionSegments(response)).toHaveLength(0);
  });

  it('never crashes on malformed spans/notices/offsets', () => {
    const response = makeResponse({
      polyline: POLYLINE,
      notices: [VIOLATED_NOTICE, null],
      spans: [
        { offset: -5, notices: [0] },        // negative offset -> skipped
        { offset: 999, notices: [0] },       // out of range -> clamped
        { notices: [0] },                    // missing offset -> skipped
        { offset: 2, notices: [42, null, 'x'] }, // bad references -> ignored
        null,                                // null span -> ignored
      ],
    });

    const segments = extractRestrictionSegments(response);
    // The out-of-range span survives with clamped points
    expect(segments.length).toBeGreaterThanOrEqual(1);
    for (const seg of segments) {
      if (seg.startPoint) {
        expect(Math.abs(seg.startPoint.lat)).toBeLessThanOrEqual(90);
        expect(Math.abs(seg.startPoint.lng)).toBeLessThanOrEqual(180);
      }
    }
  });

  it('handles a section without polyline: segment listed with null points/distance', () => {
    const response = makeResponse({
      notices: [VIOLATED_NOTICE],
      spans: [{ offset: 2, notices: [0] }],
    });

    const segments = extractRestrictionSegments(response);
    expect(segments).toHaveLength(1);
    expect(segments[0].startPoint).toBeNull();
    expect(segments[0].endPoint).toBeNull();
    expect(segments[0].approxDistanceFromOriginKm).toBeNull();
    expect(segments[0].restrictionSummary).toBe('Maximum gross weight: 9000 kg');
  });

  it('accumulates distance across earlier sections', () => {
    const response = {
      routes: [
        {
          id: 'r1',
          sections: [
            { polyline: POLYLINE }, // ~5.7 km of prior route
            {
              polyline: POLYLINE,
              notices: [VIOLATED_NOTICE],
              spans: [{ offset: 0, notices: [0] }, { offset: 2 }],
            },
          ],
        },
      ],
    } as unknown as HereRoutingResponse;

    const segments = extractRestrictionSegments(response);
    expect(segments).toHaveLength(1);
    expect(segments[0].sectionIndex).toBe(1);
    let priorKm = 0;
    for (let i = 1; i < POINTS.length; i++) {
      priorKm += haversineDistanceKm(POINTS[i - 1], POINTS[i]);
    }
    expect(segments[0].approxDistanceFromOriginKm).toBeCloseTo(Math.round(priorKm * 10) / 10, 1);
  });
});

describe('buildRestrictionSummary', () => {
  it('summarizes maxWeight with value/type', () => {
    expect(buildRestrictionSummary([{ maxWeight: { value: 7500, type: 'gross' } }]))
      .toBe('Maximum weight (gross): 7500 kg');
  });

  it('summarizes dimension and axle restrictions', () => {
    const summary = buildRestrictionSummary([
      { maxHeight: 380, maxWidth: 250, maxLength: 1200, axleCount: 3, maxAxleLoad: 8000 },
    ]);
    expect(summary).toContain('Maximum height: 380 cm');
    expect(summary).toContain('Maximum width: 250 cm');
    expect(summary).toContain('Maximum length: 1200 cm');
    expect(summary).toContain('Maximum axle count: 3');
    expect(summary).toContain('Maximum axle load: 8000 kg');
  });

  it('summarizes nested vehicleRestriction containers and time dependence', () => {
    const summary = buildRestrictionSummary([
      { vehicleRestriction: { maxGrossWeight: 12000, timeDependent: true } },
    ]);
    expect(summary).toContain('Maximum gross weight: 12000 kg');
    expect(summary).toContain('Time-dependent restriction');
  });

  it('never leaks raw restrictedTimes values (only a generic time-dependency note)', () => {
    // HERE encodes schedules in machine syntax - the raw value must not
    // appear in any user-facing summary, only a readable generic note.
    const summary = buildRestrictionSummary([{ restrictedTimes: '++++*+(t1){d1}(h10){h13}' }]);
    expect(summary).toBe('Time-dependent restriction');
    expect(summary).not.toContain('++++*+');
    expect(summary).not.toContain('(t1){d1}');
    // Human-looking values are hidden too - no exceptions, deterministic rule
    expect(buildRestrictionSummary([{ restrictedTimes: 'Mo-Fr 07:00-09:00' }]))
      .toBe('Time-dependent restriction');
    expect(buildRestrictionSummary([{ timeRule: '(M8){M1}' }]))
      .toBe('Time-dependent restriction');
  });

  it('falls back for unrecognized details', () => {
    expect(buildRestrictionSummary([])).toBe('Vehicle-specific restriction');
    expect(buildRestrictionSummary([{ something: 'else' }, null, 'text']))
      .toBe('Vehicle-specific restriction');
  });
});
