import { describe, it, expect } from 'vitest';
import { buildRestrictionDisplay } from './restriction-display.js';

const ENCODED_SCHEDULE = '++++*+(t1){d1}(h10){h13}(M8){M1}';

function display(details: unknown[], code = 'violatedVehicleRestriction', severity = 'critical') {
  return buildRestrictionDisplay({ details, code, severity });
}

describe('buildRestrictionDisplay categories', () => {
  it('gross weight restriction', () => {
    const d = display([{ maxGrossWeight: 9000 }]);
    expect(d.title).toBe('Maximum gross weight restriction');
    expect(d.message).toContain('Limit: 9,000 kg');
    expect(d.message).toContain('may exceed the permitted gross weight on this segment. Manual verification required.');
  });

  it('weight restriction (plain and value/type forms)', () => {
    expect(display([{ maxWeight: 7500 }]).title).toBe('Vehicle weight restriction');
    const d = display([{ maxWeight: { value: 7500, type: 'gross' } }]);
    expect(d.title).toBe('Vehicle weight restriction');
    expect(d.message).toContain('Limit: 7,500 kg');
    expect(d.message).toContain('may exceed a permitted weight limit on this segment. Manual verification required.');
  });

  it('height restriction with cm -> m conversion', () => {
    const d = display([{ maxHeight: 400 }]);
    expect(d.title).toBe('Vehicle height restriction');
    expect(d.message).toContain('Limit: 4 m');
    expect(d.message).toContain('may exceed the permitted height on this segment. Manual verification required.');
  });

  it('width restriction', () => {
    const d = display([{ maxWidth: 250 }]);
    expect(d.title).toBe('Vehicle width restriction');
    expect(d.message).toContain('Limit: 2.5 m');
    expect(d.message).toContain('may exceed the permitted width on this segment. Manual verification required.');
  });

  it('length restriction', () => {
    const d = display([{ maxLength: 1200 }]);
    expect(d.title).toBe('Vehicle length restriction');
    expect(d.message).toContain('Limit: 12 m');
    expect(d.message).toContain('may exceed the permitted length on this segment. Manual verification required.');
  });

  it('axle restriction (count and load forms)', () => {
    expect(display([{ axleCount: 3 }]).title).toBe('Axle restriction');
    const d = display([{ maxAxleLoad: 8000 }]);
    expect(d.title).toBe('Axle restriction');
    expect(d.message).toContain('Limit: 8,000 kg');
    expect(d.message).toContain('may violate an axle-related restriction on this segment. Manual verification required.');
  });

  it('time-dependent restriction (all input shapes)', () => {
    for (const detail of [
      { timeDependent: true },
      { restrictedTimes: ENCODED_SCHEDULE },
      { timeRule: '(t1){d1}' },
      { schedule: { encoded: true } },
    ]) {
      const d = display([detail]);
      expect(d.title).toBe('Time-dependent truck restriction');
      expect(d.message).toBe(
        'Access may depend on date, time, tunnel rules or local traffic regulations. Manual verification required.'
      );
    }
  });

  it('vehicle-specific restriction for violated notice without readable details', () => {
    const d = display([]);
    expect(d.title).toBe('Vehicle-specific restriction');
    expect(d.message).toBe(
      'HERE reports that this segment violates a restriction for the selected vehicle profile. Manual verification required.'
    );
    expect(display([{ somethingOpaque: 'xyz' }]).title).toBe('Vehicle-specific restriction');
  });

  it('generic truck restriction for unknown non-violated notices', () => {
    const d = display([], 'truckRestriction', 'info');
    expect(d.title).toBe('Truck restriction');
    expect(d.message).toBe(
      'A truck-related restriction was detected on this segment. Manual verification required.'
    );
  });

  it('nested vehicleRestriction containers are recognized', () => {
    const d = display([{ vehicleRestriction: { maxGrossWeight: 12000 } }]);
    expect(d.title).toBe('Maximum gross weight restriction');
    expect(d.message).toContain('Limit: 12,000 kg');
  });

  it('category priority: gross weight wins over time dependency', () => {
    const d = display([{ maxGrossWeight: 9000, restrictedTimes: ENCODED_SCHEDULE }]);
    expect(d.title).toBe('Maximum gross weight restriction');
    // But the hidden schedule is flagged so the UI can note it
    expect(d.rawDetailsHidden).toBe(true);
  });
});

describe('buildRestrictionDisplay hygiene', () => {
  it('never leaks encoded schedule syntax into title or message', () => {
    const cases = [
      [{ restrictedTimes: ENCODED_SCHEDULE }],
      [{ timeRule: '(h10){h13}' }],
      [{ schedule: '++++*+' }],
      [{ maxGrossWeight: 9000, restrictedTimes: ENCODED_SCHEDULE }],
    ];
    for (const details of cases) {
      const d = display(details);
      for (const fragment of ['++++*+', '(t1){d1}', '(h10){h13}', '(M8){M1}']) {
        expect(d.title).not.toContain(fragment);
        expect(d.message).not.toContain(fragment);
      }
      // No internal code as visible explanatory text either
      expect(d.title).not.toContain('violatedVehicleRestriction');
      expect(d.message).not.toContain('violatedVehicleRestriction');
    }
  });

  it('flags rawDetailsHidden only when machine data was withheld', () => {
    expect(display([{ restrictedTimes: ENCODED_SCHEDULE }]).rawDetailsHidden).toBe(true);
    expect(display([{ maxGrossWeight: 9000 }]).rawDetailsHidden).toBe(false);
  });

  it('always requires manual verification', () => {
    expect(display([{ maxGrossWeight: 9000 }]).manualVerificationRequired).toBe(true);
    expect(display([]).manualVerificationRequired).toBe(true);
  });

  it('maps severity labels deterministically', () => {
    expect(display([], 'x', 'critical').severityLabel).toBe('critical');
    expect(display([], 'x', 'info').severityLabel).toBe('info');
    expect(display([], 'x', 'low').severityLabel).toBe('warning');
    // Missing severity defaults to warning (call builder directly to bypass
    // the test helper's own default parameter)
    expect(buildRestrictionDisplay({ details: [], code: 'x' }).severityLabel).toBe('warning');
  });
});
