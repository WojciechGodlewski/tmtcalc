/**
 * User-facing display normalization for truck restriction segments.
 *
 * HERE restriction notices carry machine-readable details (encoded schedule
 * expressions like "++++*+(t1){d1}", compact limit structs, internal codes).
 * The main UI must never render that syntax - it renders the normalized
 * `display` object built here. Raw details stay in internal fields / debug.
 *
 * Every restriction requires manual verification by product rule, so
 * manualVerificationRequired is always true.
 */

export interface RestrictionDisplay {
  /** Short user-facing headline, e.g. "Maximum gross weight restriction" */
  title: string;
  /** One clear operational sentence (with readable limit when available) */
  message: string;
  severityLabel: 'critical' | 'warning' | 'info';
  manualVerificationRequired: boolean;
  /** True when machine-readable data (e.g. encoded schedules) was withheld */
  rawDetailsHidden: boolean;
}

/** What the detail scanner recognized across all detail objects */
interface ScannedRestriction {
  grossWeightKg: number | null;
  weightKg: number | null;
  heightCm: number | null;
  widthCm: number | null;
  lengthCm: number | null;
  hasAxleRestriction: boolean;
  axleLoadKg: number | null;
  hasTimeDependency: boolean;
  /** Saw an encoded/unreadable schedule or other machine syntax we hide */
  hasHiddenMachineData: boolean;
  /** Anything at all was recognized */
  recognizedAny: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function scanObject(obj: Record<string, unknown>, out: ScannedRestriction): void {
  const num = (keys: string[]): number | null => {
    for (const key of keys) {
      const v = asNumber(obj[key]);
      if (v !== null) return v;
    }
    return null;
  };

  out.grossWeightKg = out.grossWeightKg ?? num(['maxGrossWeight', 'grossWeight']);

  // maxWeight can be a number or { value, type }
  if (out.weightKg === null) {
    const plain = num(['maxWeight', 'weight']);
    if (plain !== null) {
      out.weightKg = plain;
    } else if (isRecord(obj.maxWeight)) {
      out.weightKg = asNumber(obj.maxWeight.value);
    }
  }

  out.heightCm = out.heightCm ?? num(['maxHeight', 'height']);
  out.widthCm = out.widthCm ?? num(['maxWidth', 'width']);
  out.lengthCm = out.lengthCm ?? num(['maxLength', 'length']);

  const axleLoad = num(['maxAxleLoad', 'maxWeightPerAxle', 'axleLoad']);
  if (axleLoad !== null) {
    out.hasAxleRestriction = true;
    out.axleLoadKg = out.axleLoadKg ?? axleLoad;
  }
  if (num(['axleCount', 'maxAxleCount']) !== null) {
    out.hasAxleRestriction = true;
  }

  if (obj.timeDependent === true) {
    out.hasTimeDependency = true;
  }
  for (const key of ['restrictedTimes', 'timeRule', 'schedule', 'timeRanges']) {
    const v = obj[key];
    if (v !== undefined && v !== null && v !== false) {
      out.hasTimeDependency = true;
      // Encoded expressions / structs are never rendered
      out.hasHiddenMachineData = true;
    }
  }
}

/** Scan detail objects (one nesting level of common containers) */
export function scanRestrictionDetails(details: unknown[]): ScannedRestriction {
  const out: ScannedRestriction = {
    grossWeightKg: null,
    weightKg: null,
    heightCm: null,
    widthCm: null,
    lengthCm: null,
    hasAxleRestriction: false,
    axleLoadKg: null,
    hasTimeDependency: false,
    hasHiddenMachineData: false,
    recognizedAny: false,
  };

  for (const detail of details) {
    if (!isRecord(detail)) continue;
    scanObject(detail, out);
    for (const key of ['vehicleRestriction', 'restriction', 'truckRestriction']) {
      if (isRecord(detail[key])) scanObject(detail[key] as Record<string, unknown>, out);
    }
  }

  out.recognizedAny =
    out.grossWeightKg !== null ||
    out.weightKg !== null ||
    out.heightCm !== null ||
    out.widthCm !== null ||
    out.lengthCm !== null ||
    out.hasAxleRestriction ||
    out.hasTimeDependency;

  return out;
}

function formatKg(value: number): string {
  return `${value.toLocaleString('en-GB')} kg`;
}

/** HERE dimensions are centimeters; render as meters, no unit guessing beyond that */
function formatCmAsMeters(value: number): string {
  const meters = value / 100;
  return `${(Math.round(meters * 100) / 100).toLocaleString('en-GB')} m`;
}

function severityLabelOf(severity: string | undefined | null): 'critical' | 'warning' | 'info' {
  const s = (severity ?? '').toLowerCase();
  if (s === 'critical') return 'critical';
  if (s === 'info' || s === 'information') return 'info';
  return 'warning';
}

const VIOLATED_RESTRICTION_CODE = 'violatedVehicleRestriction';

/**
 * Build the normalized user-facing display for a restriction notice/segment.
 * Deterministic category priority when multiple limits are present:
 * gross weight > weight > height > width > length > axle > time-dependent >
 * vehicle-specific > generic truck restriction.
 */
export function buildRestrictionDisplay(input: {
  details: unknown[];
  code?: string | null;
  severity?: string | null;
}): RestrictionDisplay {
  const scanned = scanRestrictionDetails(Array.isArray(input.details) ? input.details : []);
  const severityLabel = severityLabelOf(input.severity);

  const base = (title: string, message: string): RestrictionDisplay => ({
    title,
    message,
    severityLabel,
    manualVerificationRequired: true,
    rawDetailsHidden: scanned.hasHiddenMachineData,
  });

  const limit = (text: string | null, message: string): string =>
    text ? `Limit: ${text}. ${message}` : message;

  if (scanned.grossWeightKg !== null) {
    return base(
      'Maximum gross weight restriction',
      limit(
        formatKg(scanned.grossWeightKg),
        'The selected vehicle may exceed the permitted gross weight on this segment. Manual verification required.'
      )
    );
  }

  if (scanned.weightKg !== null) {
    return base(
      'Vehicle weight restriction',
      limit(
        formatKg(scanned.weightKg),
        'The selected vehicle may exceed a permitted weight limit on this segment. Manual verification required.'
      )
    );
  }

  if (scanned.heightCm !== null) {
    return base(
      'Vehicle height restriction',
      limit(
        formatCmAsMeters(scanned.heightCm),
        'The selected vehicle may exceed the permitted height on this segment. Manual verification required.'
      )
    );
  }

  if (scanned.widthCm !== null) {
    return base(
      'Vehicle width restriction',
      limit(
        formatCmAsMeters(scanned.widthCm),
        'The selected vehicle may exceed the permitted width on this segment. Manual verification required.'
      )
    );
  }

  if (scanned.lengthCm !== null) {
    return base(
      'Vehicle length restriction',
      limit(
        formatCmAsMeters(scanned.lengthCm),
        'The selected vehicle may exceed the permitted length on this segment. Manual verification required.'
      )
    );
  }

  if (scanned.hasAxleRestriction) {
    return base(
      'Axle restriction',
      limit(
        scanned.axleLoadKg !== null ? formatKg(scanned.axleLoadKg) : null,
        'The selected vehicle may violate an axle-related restriction on this segment. Manual verification required.'
      )
    );
  }

  if (scanned.hasTimeDependency) {
    return base(
      'Time-dependent truck restriction',
      'Access may depend on date, time, tunnel rules or local traffic regulations. Manual verification required.'
    );
  }

  if (input.code === VIOLATED_RESTRICTION_CODE) {
    return base(
      'Vehicle-specific restriction',
      'HERE reports that this segment violates a restriction for the selected vehicle profile. Manual verification required.'
    );
  }

  return base(
    'Truck restriction',
    'A truck-related restriction was detected on this segment. Manual verification required.'
  );
}
