/**
 * Truck restriction segment extraction from HERE Routing v8 responses.
 *
 * With the `spans=notices` query parameter (separate from `return`), HERE
 * annotates each section with `spans`: [{ offset, notices: [indexes] }].
 * A span's `notices` array holds indexes into the parent section's `notices`
 * array, and `offset` is an index into that section's decoded polyline.
 * A span applies from its offset up to the next span's offset (or the end of
 * the section when it is the last span).
 *
 * This module turns notices with code "violatedVehicleRestriction" into
 * structured segments with concrete coordinates, using the same shared
 * spec-compliant polyline decoder as routeGeometry and Alps detection.
 * Everything is defensive: malformed spans/notices/polylines never throw -
 * the caller falls back to the generic restriction warning.
 */

import { decodeFlexiblePolyline, haversineDistanceKm, type PolylinePoint } from './flexible-polyline.js';
import type { HereRoutingResponse } from './route-truck.js';

export interface RestrictionSegmentPoint {
  lat: number;
  lng: number;
}

export interface RestrictionSegment {
  code: string;
  severity: string;
  title: string;
  sectionIndex: number;
  noticeIndex: number;
  spanStartOffset: number;
  spanEndOffset: number | null;
  startPoint: RestrictionSegmentPoint | null;
  endPoint: RestrictionSegmentPoint | null;
  /** Cumulative route distance from origin to the segment start (1 decimal), or null */
  approxDistanceFromOriginKm: number | null;
  /** Raw notice details passed through for display/debugging (already compact) */
  details: unknown[];
  /** Human-readable summary derived from the notice details */
  restrictionSummary: string;
}

const VIOLATED_RESTRICTION_CODE = 'violatedVehicleRestriction';

/** Cap segments to keep responses bounded even on pathological HERE data */
const MAX_SEGMENTS = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round5(value: number): number {
  return Math.round(value * 100000) / 100000;
}

function toPoint(p: PolylinePoint | undefined): RestrictionSegmentPoint | null {
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
  return { lat: round5(p.lat), lng: round5(p.lng) };
}

/**
 * Collect restriction attributes from a single (possibly nested) detail
 * object. HERE nests limits either directly on the detail or under keys like
 * `vehicleRestriction` / `restriction` / `maxWeight`.
 */
function summarizeDetail(detail: unknown, parts: string[]): void {
  if (!isRecord(detail)) return;

  // Look one level into common containers as well as the object itself
  const candidates: Record<string, unknown>[] = [detail];
  for (const key of ['vehicleRestriction', 'restriction', 'truckRestriction']) {
    if (isRecord(detail[key])) candidates.push(detail[key] as Record<string, unknown>);
  }

  for (const obj of candidates) {
    const maxGrossWeight = asNumber(obj.maxGrossWeight);
    if (maxGrossWeight !== null) {
      parts.push(`Maximum gross weight: ${maxGrossWeight} kg`);
    }

    // maxWeight can be a plain number or { value, type }
    const maxWeightNum = asNumber(obj.maxWeight);
    if (maxWeightNum !== null) {
      parts.push(`Maximum weight: ${maxWeightNum} kg`);
    } else if (isRecord(obj.maxWeight)) {
      const value = asNumber(obj.maxWeight.value);
      const type = typeof obj.maxWeight.type === 'string' ? obj.maxWeight.type : null;
      if (value !== null) {
        parts.push(type ? `Maximum weight (${type}): ${value} kg` : `Maximum weight: ${value} kg`);
      }
    }

    const maxHeight = asNumber(obj.maxHeight);
    if (maxHeight !== null) parts.push(`Maximum height: ${maxHeight} cm`);

    const maxWidth = asNumber(obj.maxWidth);
    if (maxWidth !== null) parts.push(`Maximum width: ${maxWidth} cm`);

    const maxLength = asNumber(obj.maxLength);
    if (maxLength !== null) parts.push(`Maximum length: ${maxLength} cm`);

    const axleCount = asNumber(obj.axleCount) ?? asNumber(obj.maxAxleCount);
    if (axleCount !== null) parts.push(`Maximum axle count: ${axleCount}`);

    const axleLoad = asNumber(obj.maxAxleLoad) ?? asNumber(obj.maxWeightPerAxle);
    if (axleLoad !== null) parts.push(`Maximum axle load: ${axleLoad} kg`);

    // Time-dependent restrictions
    if (obj.timeDependent === true) {
      parts.push('Time-dependent restriction');
    }
    if (typeof obj.restrictedTimes === 'string' && obj.restrictedTimes) {
      parts.push(`Restricted times: ${obj.restrictedTimes}`);
    } else if (isRecord(obj.restrictedTimes) || Array.isArray(obj.restrictedTimes)) {
      parts.push('Time-dependent restriction');
    }
  }
}

/**
 * Build a human-readable summary from a notice's details array.
 * Falls back to "Vehicle-specific restriction" when nothing recognizable.
 */
export function buildRestrictionSummary(details: unknown[]): string {
  const parts: string[] = [];
  for (const detail of details) {
    summarizeDetail(detail, parts);
  }
  // De-duplicate while preserving order
  const unique = Array.from(new Set(parts));
  return unique.length > 0 ? unique.join('; ') : 'Vehicle-specific restriction';
}

/**
 * Extract violated-vehicle-restriction segments from all route sections.
 * Never throws on malformed data; returns [] when nothing can be extracted.
 */
export function extractRestrictionSegments(response: HereRoutingResponse): RestrictionSegment[] {
  const segments: RestrictionSegment[] = [];

  const route = response?.routes?.[0];
  if (!route || !Array.isArray(route.sections)) return segments;

  // Cumulative route distance at the start of each section
  let priorSectionsKm = 0;

  for (let sectionIndex = 0; sectionIndex < route.sections.length; sectionIndex++) {
    const section = route.sections[sectionIndex];

    // Decode this section's polyline with the shared corrected decoder
    let points: PolylinePoint[] = [];
    if (typeof section?.polyline === 'string' && section.polyline) {
      try {
        points = decodeFlexiblePolyline(section.polyline);
      } catch {
        points = [];
      }
    }

    // Cumulative km from section start for each point index
    const cumKm: number[] = new Array(points.length);
    for (let i = 0; i < points.length; i++) {
      cumKm[i] = i === 0 ? 0 : cumKm[i - 1] + haversineDistanceKm(points[i - 1], points[i]);
    }

    const notices = Array.isArray(section?.notices) ? section.notices : [];
    const spans = Array.isArray(section?.spans) ? section.spans : [];

    // Indexes of violated-vehicle-restriction notices in this section
    const violatedIndexes = new Set<number>();
    for (let n = 0; n < notices.length; n++) {
      if (notices[n] && notices[n].code === VIOLATED_RESTRICTION_CODE) {
        violatedIndexes.add(n);
      }
    }

    if (violatedIndexes.size === 0 || spans.length === 0) {
      priorSectionsKm += points.length > 0 ? cumKm[points.length - 1] : 0;
      continue;
    }

    // For each violated notice, find the span indexes that reference it
    const spanIndexesByNotice = new Map<number, number[]>();
    for (let s = 0; s < spans.length; s++) {
      const span = spans[s];
      if (!isRecord(span)) continue;
      // Spans without a usable offset cannot be located - skip them up front
      const offset = asNumber(span.offset);
      if (offset === null || offset < 0) continue;
      const refs = Array.isArray(span.notices) ? (span.notices as unknown[]) : [];
      for (const ref of refs) {
        if (typeof ref === 'number' && violatedIndexes.has(ref)) {
          const list = spanIndexesByNotice.get(ref) ?? [];
          list.push(s);
          spanIndexesByNotice.set(ref, list);
        }
      }
    }

    for (const [noticeIndex, spanIndexes] of spanIndexesByNotice) {
      const notice = notices[noticeIndex];
      const details = Array.isArray(notice.details) ? notice.details : [];

      // Group adjacent spans (consecutive indexes in the spans array) into
      // runs so one contiguous restricted stretch yields one segment.
      spanIndexes.sort((a, b) => a - b);
      const runs: Array<[number, number]> = [];
      let runStart = spanIndexes[0];
      let prev = spanIndexes[0];
      for (let i = 1; i <= spanIndexes.length; i++) {
        const cur = spanIndexes[i];
        if (cur !== prev + 1) {
          runs.push([runStart, prev]);
          runStart = cur;
        }
        prev = cur;
      }

      for (const [firstSpanIdx, lastSpanIdx] of runs) {
        if (segments.length >= MAX_SEGMENTS) break;

        const startOffset = asNumber(spans[firstSpanIdx]?.offset);
        if (startOffset === null || startOffset < 0) continue; // defensive; filtered above

        // Segment ends at the next span's offset, or at the section's last point
        const nextSpan = spans[lastSpanIdx + 1];
        let endOffset: number | null = asNumber(nextSpan?.offset);
        if (endOffset === null) {
          endOffset = points.length > 0 ? points.length - 1 : null;
        }

        // Clamp offsets into the decoded point range (guards bad HERE data)
        const clamp = (v: number) =>
          points.length > 0 ? Math.min(Math.max(v, 0), points.length - 1) : -1;
        const startIdx = clamp(startOffset);
        const endIdx = endOffset !== null ? clamp(endOffset) : -1;

        const startPoint = startIdx >= 0 ? toPoint(points[startIdx]) : null;
        const endPoint = endIdx >= 0 ? toPoint(points[endIdx]) : null;

        const approxDistanceFromOriginKm =
          startIdx >= 0 && cumKm.length > startIdx
            ? Math.round((priorSectionsKm + cumKm[startIdx]) * 10) / 10
            : null;

        segments.push({
          code: VIOLATED_RESTRICTION_CODE,
          severity: typeof notice.severity === 'string' && notice.severity ? notice.severity : 'warning',
          title: typeof notice.title === 'string' && notice.title ? notice.title : VIOLATED_RESTRICTION_CODE,
          sectionIndex,
          noticeIndex,
          spanStartOffset: startOffset,
          spanEndOffset: endOffset,
          startPoint,
          endPoint,
          approxDistanceFromOriginKm,
          details,
          restrictionSummary: buildRestrictionSummary(details),
        });
      }
    }

    priorSectionsKm += points.length > 0 ? cumKm[points.length - 1] : 0;
  }

  return segments;
}
