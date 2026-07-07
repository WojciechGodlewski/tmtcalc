import { useEffect, useState } from 'react';
import { requestQuote } from './api';
import type { QuoteRequest, QuoteResponse } from './types';
import {
  addPoint,
  canAddPoint,
  clearPoints,
  derivePayloadLocations,
  removePoint,
  undoLastPoint,
  MAX_ROUTE_POINTS,
  type RoutePoint,
} from './route-points';
import { QuoteForm, type FormState } from './components/QuoteForm';
import { AdmissibilityBanner } from './components/AdmissibilityBanner';
import { QuoteResult } from './components/QuoteResult';
import { RouteMap } from './components/RouteMap';
import { RouteFactsPanel } from './components/RouteFactsPanel';
import { DebugPanel } from './components/DebugPanel';
import { ErrorMessage } from './components/ErrorMessage';

const INITIAL_FORM: FormState = {
  origin: '',
  destination: '',
  viaText: '',
  excludeCountriesText: '',
  vehicleProfileId: 'solo_18t_23ep',
};

export function App() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [planningPoints, setPlanningPoints] = useState<RoutePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QuoteResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  function handleMapClick(point: RoutePoint) {
    if (loading) return;
    setPlanningPoints((points) => {
      if (!canAddPoint(points)) {
        setValidationMessage(`At most ${MAX_ROUTE_POINTS} route points are supported.`);
        return points;
      }
      setValidationMessage(null);
      return addPoint(points, point);
    });
    // A new click starts re-planning: drop the previous result so the
    // planning markers become visible again.
    setResult(null);
    setError(null);
  }

  // Internal hook so headless checks (and the browser console) can add
  // planning points without a live HERE map:
  // window.dispatchEvent(new CustomEvent('tmtcalc-add-point', { detail: { lat, lng } }))
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<RoutePoint>).detail;
      if (detail && typeof detail.lat === 'number' && typeof detail.lng === 'number') {
        handleMapClick(detail);
      }
    };
    window.addEventListener('tmtcalc-add-point', listener);
    return () => window.removeEventListener('tmtcalc-add-point', listener);
    // handleMapClick only uses setters + loading; loading staleness is
    // avoided by re-registering when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  async function handleSubmit() {
    const usingMapPoints = planningPoints.length > 0;

    // Common option fields
    const excludeCountries = form.excludeCountriesText
      .split(',')
      .map((code) => code.trim().toUpperCase())
      .filter((code) => code.length > 0);

    let payload: QuoteRequest;

    if (usingMapPoints) {
      const locations = derivePayloadLocations(planningPoints);
      if (!locations) {
        setValidationMessage('Add at least two points on the map (origin and destination).');
        setResult(null);
        setError(null);
        return;
      }
      setValidationMessage(null);
      payload = {
        origin: locations.origin,
        destination: locations.destination,
        ...(locations.via.length > 0 ? { via: locations.via } : {}),
        vehicleProfileId: form.vehicleProfileId,
        includeGeometry: true,
        ...(excludeCountries.length > 0 ? { excludeCountries } : {}),
      };
    } else {
      const origin = form.origin.trim();
      const destination = form.destination.trim();

      if (!origin || !destination) {
        setValidationMessage('Please enter both an origin and a destination address.');
        setResult(null);
        setError(null);
        return;
      }
      setValidationMessage(null);

      const via = form.viaText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((address) => ({ address }));

      payload = {
        origin: { address: origin },
        destination: { address: destination },
        ...(via.length > 0 ? { via } : {}),
        vehicleProfileId: form.vehicleProfileId,
        includeGeometry: true,
        ...(excludeCountries.length > 0 ? { excludeCountries } : {}),
      };
    }

    setLoading(true);
    setError(null);
    try {
      const response = await requestQuote(payload);
      setResult(response);
    } catch (err) {
      setResult(null);
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  // Labels for planning points, available after a quote from resolvedPoints
  // (origin, vias, destination in order)
  const pointLabels: Array<string | null> = (() => {
    const rp = result?.debug?.resolvedPoints;
    if (!rp || planningPoints.length < 2) return planningPoints.map(() => null);
    return [
      rp.origin?.label ?? null,
      ...(rp.waypoints ?? []).map((wp) => wp.label ?? null),
      rp.destination?.label ?? null,
    ].slice(0, planningPoints.length);
  })();

  return (
    <div className="app">
      <header className="app-header">
        <h1>TMT Calc</h1>
        <p className="subtitle">Transport quote calculator</p>
      </header>

      <QuoteForm
        form={form}
        loading={loading}
        planningPoints={planningPoints}
        pointLabels={pointLabels}
        onChange={setForm}
        onSubmit={handleSubmit}
        onRemovePoint={(i) => setPlanningPoints((p) => removePoint(p, i))}
        onUndoPoint={() => setPlanningPoints((p) => undoLastPoint(p))}
        onClearPoints={() => {
          // "Clear points" is a full restart of map planning: it also
          // dismisses the displayed result so the map returns to a clean
          // planning canvas.
          setPlanningPoints(clearPoints());
          setResult(null);
          setError(null);
          setValidationMessage(null);
        }}
        onPresetApplied={() => setPlanningPoints(clearPoints())}
      />

      {validationMessage && (
        <div className="card error-card" role="alert">
          <strong>{validationMessage}</strong>
        </div>
      )}

      {loading && (
        <div className="card loading-card" role="status">
          Calculating quote… (geocoding + HERE truck routing can take a few seconds)
        </div>
      )}

      {!loading && error != null && <ErrorMessage error={error} />}

      {/* Hierarchy: hard status banner -> map -> quote -> facts -> debug.
          The map is persistent: it doubles as the click-to-plan canvas
          before a result exists. */}
      {!loading && result && (
        <AdmissibilityBanner
          admissibility={result.admissibility}
          excludedCountries={result.debug?.hereRequest?.excludeCountries ?? []}
        />
      )}

      <RouteMap
        geometry={!loading && result ? result.routeGeometry : undefined}
        resolvedPoints={!loading && result ? result.debug?.resolvedPoints : undefined}
        restrictionSegments={
          !loading && result ? result.routeFacts.regulatory.restrictionSegments : undefined
        }
        planningPoints={planningPoints}
        onMapClick={handleMapClick}
        hasResult={!loading && result !== null}
      />

      {!loading && result && (
        <>
          <QuoteResult result={result} />
          <RouteFactsPanel routeFacts={result.routeFacts} />
          <DebugPanel debug={result.debug} />
        </>
      )}
    </div>
  );
}
