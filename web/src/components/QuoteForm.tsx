import type { VehicleProfileId } from '../types';

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
  onChange: (form: FormState) => void;
  onSubmit: () => void;
}

export function QuoteForm({ form, loading, onChange, onSubmit }: QuoteFormProps) {
  const set = (patch: Partial<FormState>) => onChange({ ...form, ...patch });

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

      <div className="form-grid">
        <label className="field">
          <span className="field-label">Origin</span>
          <input
            type="text"
            value={form.origin}
            placeholder="e.g. Poznań, Poland"
            onChange={(e) => set({ origin: e.target.value })}
          />
        </label>

        <label className="field">
          <span className="field-label">Destination</span>
          <input
            type="text"
            value={form.destination}
            placeholder="e.g. Verona, Italy"
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
