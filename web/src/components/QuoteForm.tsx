import type { VehicleProfileId } from '../types';
import {
  addEmptyStop,
  addressStops,
  removeStop,
  stopRole,
  updateAddressStop,
  isEmptyStop,
  MAX_STOPS,
  type Stop,
} from '../route-stops';

export interface FormState {
  /** Unified route stops: typed addresses and clicked map points, in order */
  stops: Stop[];
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
    state: {
      stops: addressStops(['Poznań, Poland', 'Verona, Italy']),
      excludeCountriesText: '',
      vehicleProfileId: 'solo_18t_23ep',
    },
  },
  {
    label: 'Verona → Munich',
    state: {
      stops: addressStops(['Verona, Italy', 'Munich, Germany']),
      excludeCountriesText: '',
      vehicleProfileId: 'solo_18t_23ep',
    },
  },
  {
    label: 'Verona → London',
    state: {
      stops: addressStops(['Verona, Italy', 'London, United Kingdom']),
      excludeCountriesText: '',
      vehicleProfileId: 'solo_18t_23ep',
    },
  },
  {
    label: 'Turin → Chambéry (Fréjus)',
    state: {
      stops: addressStops(['Turin, Italy', 'Bardonecchia, Italy', 'Modane, France', 'Chambéry, France']),
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
  /** Resolved labels per stop row (after a quote); null when unknown */
  stopLabels: Array<string | null>;
  onChange: (form: FormState) => void;
  onSubmit: () => void;
  /** "Clear quote" button: dismiss the result and drop clicked map points */
  onClearQuote: () => void;
  /** Whether there is anything to clear (result, error, or clicked points) */
  canClearQuote: boolean;
}

export function QuoteForm({
  form,
  loading,
  stopLabels,
  onChange,
  onSubmit,
  onClearQuote,
  canClearQuote,
}: QuoteFormProps) {
  const set = (patch: Partial<FormState>) => onChange({ ...form, ...patch });
  const setStops = (stops: Stop[]) => set({ stops });

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
            onClick={() => onChange(preset.state)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="stops-section">
        <span className="field-label">
          Route stops <span className="muted">(first is the origin, last is the destination)</span>
        </span>
        <ol className="stops-list">
          {form.stops.map((stop, i) => {
            const role = stopRole(form.stops, i);
            const badgeClass =
              role === 'A' ? 'a' : role === 'B' ? 'b' : role === '·' ? 'empty' : 'via';
            return (
              <li key={i} className="stop-row" data-testid="stop-row">
                <span className={`point-badge point-badge-${badgeClass}`}>{role}</span>
                {stop.kind === 'address' ? (
                  <input
                    type="text"
                    className="stop-input"
                    value={stop.address}
                    placeholder="Type an address or click the map"
                    onChange={(e) => setStops(updateAddressStop(form.stops, i, e.target.value))}
                  />
                ) : (
                  <span className="stop-point-chip" data-testid="stop-point">
                    {stopLabels[i] ? (
                      <>
                        {stopLabels[i]} <span className="muted">({stop.lat}, {stop.lng})</span>
                      </>
                    ) : (
                      <>Map point ({stop.lat}, {stop.lng})</>
                    )}
                  </span>
                )}
                <button
                  type="button"
                  className="point-remove-btn"
                  aria-label={`Remove stop ${i + 1}`}
                  onClick={() => setStops(removeStop(form.stops, i))}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ol>
        <div className="stops-actions">
          <button
            type="button"
            className="preset-btn"
            disabled={form.stops.length >= MAX_STOPS}
            onClick={() => setStops(addEmptyStop(form.stops))}
          >
            + Add stop
          </button>
          {form.stops.some((s) => !isEmptyStop(s) && s.kind === 'point') && (
            <span className="muted stops-note">Clicked map points can be removed with ×.</span>
          )}
        </div>
      </div>

      <div className="form-grid">
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

        <div className="field submit-field field-wide">
          <div className="submit-row">
            <button type="submit" className="submit-btn" disabled={loading}>
              {loading ? 'Calculating…' : 'Calculate quote'}
            </button>
            <button
              type="button"
              className="clear-quote-btn"
              disabled={loading || !canClearQuote}
              onClick={onClearQuote}
            >
              Clear quote
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
