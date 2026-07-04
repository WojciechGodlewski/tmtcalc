/**
 * Route admissibility / quote validity model.
 *
 * TMT Calc evaluates ONE requested route under the user's hard constraints -
 * it never computes baseline routes, candidates, or alternatives that ignore
 * those constraints. Hard constraint hierarchy:
 *
 *   1. the route must exist (origin/destination/via routable),
 *   2. excluded countries must be avoided (strict - enforced at request time),
 *   3. the selected vehicle must be able to pass the route,
 *   4. only then is the price a valid operational quote.
 *
 * Ferry / UK crossing / Alps tunnel / tolls / distance / duration / surcharges
 * / minimums are PRICING COMPONENTS, never route blockers.
 *
 * Decision rules (deterministic, documented in README):
 * - truck_restricted: HERE reported a violatedVehicleRestriction for this
 *   route - either a located restriction segment with severity "critical",
 *   or a violatedVehicleRestriction notice without span data. HERE marks
 *   violated restrictions for the given vehicle profile explicitly, so this
 *   is treated as a hard violation, not a soft warning.
 * - warning: other truck-related restriction notices (truckRestricted=true
 *   without any violatedVehicleRestriction evidence). The route is delivered
 *   as usable and the quote stays valid, but the UI must require manual
 *   verification. This is the safest interpretation that does not block
 *   quoting on ambiguous notices.
 * - pricing_unavailable: route passes all hard constraints but no pricing
 *   model exists for the lane/vehicle.
 * - no_route is represented by the structured NO_ROUTE_FOUND error response
 *   (existing API style) rather than a 200 body; buildNoRouteAdmissibility()
 *   documents the equivalent shape for consumers that want it.
 * - valid: everything above passes.
 */

import type { RouteFacts, RestrictionSegment } from '../types/route-facts.js';
import { haversineDistanceKm } from '../here/flexible-polyline.js';

export type AdmissibilityStatus =
  | 'valid'
  | 'warning'
  | 'truck_restricted'
  | 'no_route'
  | 'pricing_unavailable';

export type FailedConstraint =
  | 'route_not_found'
  | 'excluded_country'
  | 'vehicle_restriction'
  | 'pricing_model';

export interface Admissibility {
  status: AdmissibilityStatus;
  /** True only when the price may be used as an operational quote */
  quoteValid: boolean;
  /** True when the route itself satisfies all hard routing constraints */
  routeUsable: boolean;
  hardConstraintViolation: boolean;
  reason: string | null;
  messages: string[];
  failedConstraints: FailedConstraint[];
}

const VIOLATED_RESTRICTION_CODE = 'violatedVehicleRestriction';

/** Approximate total restricted distance (straight-line per segment), or null */
function approxRestrictedKm(segments: RestrictionSegment[]): number | null {
  let total = 0;
  let counted = 0;
  for (const seg of segments) {
    if (seg.startPoint && seg.endPoint) {
      total += haversineDistanceKm(seg.startPoint, seg.endPoint);
      counted++;
    }
  }
  if (counted === 0) return null;
  return Math.round(total * 10) / 10;
}

export interface AdmissibilityInput {
  routeFacts: RouteFacts;
  /** Normalized alpha-3 exclusions that were applied to the request */
  excludeCountries: string[];
  /** Whether a pricing model was found for the lane/vehicle */
  pricingModelFound: boolean;
}

/**
 * Evaluate admissibility for a successfully calculated route.
 * (No-route and excluded-origin/destination cases fail earlier with
 * structured errors and never reach this function.)
 */
export function evaluateAdmissibility(input: AdmissibilityInput): Admissibility {
  const { routeFacts, excludeCountries, pricingModelFound } = input;
  const regulatory = routeFacts.regulatory;
  const segments = regulatory.restrictionSegments ?? [];

  // Evidence that HERE reported a violated restriction for THIS vehicle:
  // a located critical segment, or a violated notice without span data.
  const criticalSegments = segments.filter(
    (s) => s.code === VIOLATED_RESTRICTION_CODE && s.severity === 'critical'
  );
  const violatedNoticeWithoutSegments =
    segments.length === 0 &&
    routeFacts.raw.warnings.some((w) => w.code === VIOLATED_RESTRICTION_CODE);

  if (criticalSegments.length > 0 || violatedNoticeWithoutSegments) {
    const messages: string[] = [
      'The calculated route satisfies the requested country exclusions, but HERE reports vehicle restriction violations for the selected truck profile.',
    ];

    const restrictedKm = approxRestrictedKm(criticalSegments);
    if (restrictedKm !== null && restrictedKm > 0) {
      messages.push(`Vehicle restriction detected on approximately ${restrictedKm} km of the route.`);
    } else if (violatedNoticeWithoutSegments) {
      messages.push('HERE did not provide the exact location of the violated restriction - verify the whole route manually.');
    }

    if (excludeCountries.length > 0) {
      messages.push('The selected country exclusions were applied. The problem is vehicle passability, not country avoidance.');
    }

    return {
      status: 'truck_restricted',
      quoteValid: false,
      routeUsable: false,
      hardConstraintViolation: true,
      reason: 'Route found, but not valid for selected vehicle.',
      messages,
      failedConstraints: ['vehicle_restriction'],
    };
  }

  // Other truck-related notices without violated-restriction evidence:
  // deliver the route/quote but require manual verification.
  if (regulatory.truckRestricted) {
    return {
      status: 'warning',
      quoteValid: pricingModelFound,
      routeUsable: true,
      hardConstraintViolation: false,
      reason: 'HERE returned truck-related warnings for this route.',
      messages: [
        'Manual verification required before operational use.',
        ...regulatory.restrictionReasons.slice(0, 5),
        ...(pricingModelFound ? [] : ['No pricing model is available for this lane and vehicle.']),
      ],
      failedConstraints: pricingModelFound ? [] : ['pricing_model'],
    };
  }

  if (!pricingModelFound) {
    return {
      status: 'pricing_unavailable',
      quoteValid: false,
      routeUsable: true,
      hardConstraintViolation: false,
      reason: 'Route is valid, but no pricing model is available for this lane.',
      messages: ['The route satisfies all hard constraints; only pricing coverage is missing.'],
      failedConstraints: ['pricing_model'],
    };
  }

  return {
    status: 'valid',
    quoteValid: true,
    routeUsable: true,
    hardConstraintViolation: false,
    reason: null,
    messages: [],
    failedConstraints: [],
  };
}

/**
 * Admissibility shape equivalent to the NO_ROUTE_FOUND structured error.
 * (The API returns the error response; this exists for documentation/tests.)
 */
export function buildNoRouteAdmissibility(excludeCountries: string[]): Admissibility {
  return {
    status: 'no_route',
    quoteValid: false,
    routeUsable: false,
    hardConstraintViolation: true,
    reason:
      excludeCountries.length > 0
        ? 'No route found with selected country exclusions.'
        : 'No route found between origin and destination.',
    messages: [],
    failedConstraints: ['route_not_found'],
  };
}
