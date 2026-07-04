/**
 * Compact, sanitized debug preview of restriction segments for API debug
 * payloads: bounded size, no raw HERE dumps, no keys.
 */

import type { RestrictionSegment } from '../types/route-facts.js';

export interface RestrictionSegmentPreview {
  code: string;
  severity: string;
  sectionIndex: number;
  spanStartOffset: number;
  spanEndOffset: number | null;
  approxDistanceFromOriginKm: number | null;
  restrictionSummary: string;
}

const MAX_PREVIEW_SEGMENTS = 5;

export function buildRestrictionDebug(segments: RestrictionSegment[] | undefined): {
  restrictionSegmentsCount: number;
  restrictionSegmentsPreview: RestrictionSegmentPreview[];
} {
  const list = segments ?? [];
  return {
    restrictionSegmentsCount: list.length,
    restrictionSegmentsPreview: list.slice(0, MAX_PREVIEW_SEGMENTS).map((s) => ({
      code: s.code,
      severity: s.severity,
      sectionIndex: s.sectionIndex,
      spanStartOffset: s.spanStartOffset,
      spanEndOffset: s.spanEndOffset,
      approxDistanceFromOriginKm: s.approxDistanceFromOriginKm,
      restrictionSummary: s.restrictionSummary,
    })),
  };
}
