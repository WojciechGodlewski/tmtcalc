import type { VehicleProfileId } from '../types';
import { pointRole, type RoutePoint } from '../route-points';

export interface FormState {
  origin: string;
  destination: string;
  viaText: string;
  /** Comma-separated country codes to exclude, e.g. "CH, AT" */
  excludeCountriesText: string;
  vehicleProfileId: VehicleProfileId;
}

interface Preset {
  label: string;
  state: FormState;
}

/** The four golden scenarios as one-click form presets (no auto-submit). */
const PRESETS: Preset[] = [
  {
    label: 'Poznań → Verona',
    state: { origin: 'Poznań, Poland', destination: 'Verona, Italy', viaText: '', excludeCountriesText: '', vehicleProfileId: 'solo_18t_23ep' },
  },
  {
    label: 'Verona → Munich',
    state: { origin: 'Verona, Italy', destination: 'Munich, Germany', viaText: '', excludeCountriesText: '', vehicleProfileId: 'solo_18t_23ep' },
  },
  {
    label: 'Verona → London',
    state: { origin: 'Verona, Italy', destination: 'London, United Kingdom', viaText: '', excludeCountriesText: '', vehicleProfileId: 'solo_18t_23ep' },
  },
  {
    label: 'Turin → Chambéry (Fréjus)',
    state: {
      origin: 'Turin, Italy',
      destination: 'Chambéry, France',
      viaText: 'Bardonecchia, Italy\nModane, France',
      excludeCountriesText: '',
      vehicleProfileId: 'solo_18t_23ep',
    },
  },
];

const VEHICLE_PROFILES: Array<{ id: VehicleProfileId; label: string }> = [
  { id: 'solo_18t_23ep', label: 'Solo 18t / 23 EP' },
  { id: 'van_8ep', label: 'Van 3.5t / 8 EP' },
  { id: 'ftl_13_6_33ep', label: 'FTL 13.6m / 33 EP' },
];

interface QuoteFormProps {
  form: FormState;
  loading: boolean;
  /** Click-to-plan points from the map; when non-empty they replace addresses */
  planningPoints: RoutePoint[];
  /** Resolved labels per point (after a quote), aligned with planningPoints */
  pointLabels: Array<string | null>;
  onChange: (form: FormState) => void;
  onSubmit: () => void;
  onRemovePoint: (index: number) => void;
  onUndoPoint: () => void;
  /** "Clear points" button: full planning restart (also dismisses the result) */
  onClearPoints: () => void;
  /** Preset applied: leave map mode but keep any displayed result */
  onPresetApplied: () => void;
}

export function QuoteForm({
  form,
  loading,
  planningPoints,
  pointLabels,
  onChange,
  onSubmit,
  onRemovePoint,
  onUndoPoint,
  onClearPoints,
  onPresetApplied,
}: QuoteFormProps) {
  const set = (patch: Partial<FormState>) => onChange({ ...form, ...patch });
  // Map points take precedence over typed addresses while present
  const usingMapPoints = planningPoints.length > 0;

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="presets">
        <span className="presets-label">Presets:</span>
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="preset-btn"
            onClick={() => {
              // Presets are address-based: applying one leaves map-planning
              // mode (without dismissing a displayed result)
              onChange(preset.state);
              onPresetApplied();
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {usingMapPoints && (
        <div className="map-points" data-testid="map-points">
          <div className="map-points-head">
            <span className="field-label">
              Route points from map <span className="muted">({planningPoints.length})</span>
            </span>
            <span className="map-points-actions">
              <button type="button" className="preset-btn" onClick={onUndoPoint}>
                Undo last
              </button>
              <button type="button" className="preset-btn" onClick={onClearPoints}>
                Clear points
              </button>
            </span>
          </div>
          <ol className="map-points-list">
            {planningPoints.map((point, i) => {
              const role = pointRole(planningPoints, i);
              return (
                <li key={`${point.lat},${point.lng},${i}`} className="map-point-row">
                  <span className={`point-badge point-badge-${role === 'A' ? 'a' : role === 'B' ? 'b' : 'via'}`}>
                    {role}
                  </span>
                  <span className="map-point-text">
                    {pointLabels[i] ? (
                      <>
                        {pointLabels[i]} <span className="muted">({point.lat}, {point.lng})</span>
                      </>
                    ) : (
                      <>{point.lat}, {point.lng}</>
                    )}
                  </span>
                  <button
                    type="button"
                    className="point-remove-btn"
                    aria-label={`Remove point ${role}`}
                    onClick={() => onRemovePoint(i)}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="muted map-points-note">
            First point is the origin, last is the destination. Address fields are ignored while
            map points are set.
          </p>
        </div>
      )}

      <div className="form-grid">
        <label className="field">
          <span className="field-label">Origin</span>
          <input
            type="text"
            value={form.origin}
            placeholder="e.g. Poznań, Poland"
            disabled={usingMapPoints}
            onChange={(e) => set({ origin: e.target.value })}
          />
        </label>

        <label className="field">
          <span className="field-label">Destination</span>
          <input
            type="text"
            value={form.destination}
            placeholder="e.g. Verona, Italy"
            disabled={usingMapPoints}
            onChange={(e) => set({ destination: e.target.value })}
          />
        </label>

        <label className="field field-wide">
          <span className="field-label">
            Via / waypoints <span className="muted">(optional, one per line)</span>
          </span>
          <textarea
            rows={3}
            value={form.viaText}
            placeholder={'e.g.\nBardonecchia, Italy\nModane, France'}
            disabled={usingMapPoints}
            onChange={(e) => set({ viaText: e.target.value })}
          />
        </label>

        <label className="field">
          <span className="field-label">
            Avoid countries{' '}
            <button
              type="button"
              className="preset-btn quick-avoid-btn"
              onClick={() => {
                const codes = form.excludeCountriesText
                  .split(',')
                  .map((c) => c.trim().toUpperCase())
                  .filter(Boolean);
                if (!codes.includes('CH') && !codes.includes('CHE')) {
                  set({
                    excludeCountriesText: codes.length > 0
                      ? `${form.excludeCountriesText.trim().replace(/,\s*$/, '')}, CH`
                      : 'CH',
                  });
                }
              }}
            >
              Avoid CH
            </button>
          </span>
          <input
            type="text"
            value={form.excludeCountriesText}
            placeholder="e.g. CH, AT"
            onChange={(e) => set({ excludeCountriesText: e.target.value })}
          />
          <span className="field-help muted">
            Optional. Enter country codes separated by commas, e.g. CH, AT.
          </span>
        </label>

        <label className="field">
          <span className="field-label">Vehicle profile</span>
          <select
            value={form.vehicleProfileId}
            onChange={(e) => set({ vehicleProfileId: e.target.value as VehicleProfileId })}
          >
            {VEHICLE_PROFILES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <div className="field submit-field">
          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? 'Calculating…' : 'Calculate quote'}
          </button>
        </div>
      </div>
    </form>
  );
}
