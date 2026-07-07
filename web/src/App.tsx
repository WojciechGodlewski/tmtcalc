import { useEffect, useState } from 'react';
import { requestQuote } from './api';
import type { QuoteRequest, QuoteResponse } from './types';
import {
  addPointStop,
  canAcceptPoint,
  derivePayloadLocations,
  emptyStops,
  filledStops,
  isEmptyStop,
  planningMarkers,
  MAX_STOPS,
} from './route-stops';
import { QuoteForm, type FormState } from './components/QuoteForm';
import { AdmissibilityBanner } from './components/AdmissibilityBanner';
import { QuoteResult } from './components/QuoteResult';
import { RouteMap } from './components/RouteMap';
import { RouteFactsPanel } from './components/RouteFactsPanel';
import { DebugPanel } from './components/DebugPanel';
import { ErrorMessage } from './components/ErrorMessage';

const INITIAL_FORM: FormState = {
  stops: emptyStops(),
  excludeCountriesText: '',
  vehicleProfileId: 'solo_18t_23ep',
};

export function App() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QuoteResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  function handleMapClick(point: { lat: number; lng: number }) {
    if (loading) return;
    setForm((current) => {
      if (!canAcceptPoint(current.stops)) {
        setValidationMessage(`At most ${MAX_STOPS} route stops are supported.`);
        return current;
      }
      setValidationMessage(null);
      return { ...current, stops: addPointStop(current.stops, point) };
    });
    // A new click starts re-planning: drop the previous result so the
    // planning markers become visible again.
    setResult(null);
    setError(null);
  }

  // Internal hook so headless checks (and the browser console) can add
  // stops without a live HERE map:
  // window.dispatchEvent(new CustomEvent('tmtcalc-add-point', { detail: { lat, lng } }))
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ lat: number; lng: number }>).detail;
      if (detail && typeof detail.lat === 'number' && typeof detail.lng === 'number') {
        handleMapClick(detail);
      }
    };
    window.addEventListener('tmtcalc-add-point', listener);
    return () => window.removeEventListener('tmtcalc-add-point', listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  async function handleSubmit() {
    // ONE submit path: the stop list is the single source of truth, whether
    // stops were typed or clicked. Country exclusions apply identically.
    const locations = derivePayloadLocations(form.stops);
    if (!locations) {
      setValidationMessage('Enter or click at least two stops (origin and destination).');
      setResult(null);
      setError(null);
      return;
    }
    setValidationMessage(null);

    const excludeCountries = form.excludeCountriesText
      .split(',')
      .map((code) => code.trim().toUpperCase())
      .filter((code) => code.length > 0);

    const payload: QuoteRequest = {
      origin: locations.origin,
      destination: locations.destination,
      ...(locations.via.length > 0 ? { via: locations.via } : {}),
      vehicleProfileId: form.vehicleProfileId,
      includeGeometry: true,
      ...(excludeCountries.length > 0 ? { excludeCountries } : {}),
    };

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

  // "Clear quote" resets everything route-related: the whole stop list
  // (typed addresses AND clicked points), the map, and the calculated
  // result/error. Vehicle profile and country exclusions are settings and
  // stay as they are.
  function handleClearQuote() {
    setForm((current) => ({ ...current, stops: emptyStops() }));
    setResult(null);
    setError(null);
    setValidationMessage(null);
  }

  const hasFilledStops = filledStops(form.stops).length > 0;

  // Labels for stop rows, available after a quote from resolvedPoints
  // (origin, vias, destination in filled order)
  const stopLabels: Array<string | null> = (() => {
    const rp = result?.debug?.resolvedPoints;
    const labels = form.stops.map(() => null as string | null);
    if (!rp) return labels;
    const resolvedInOrder = [
      rp.origin?.label ?? null,
      ...(rp.waypoints ?? []).map((wp) => wp.label ?? null),
      rp.destination?.label ?? null,
    ];
    const filled = filledStops(form.stops);
    if (filled.length !== resolvedInOrder.length) return labels;
    let filledIdx = 0;
    form.stops.forEach((stop, i) => {
      if (!isEmptyStop(stop)) {
        labels[i] = resolvedInOrder[filledIdx];
        filledIdx++;
      }
    });
    return labels;
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
        stopLabels={stopLabels}
        onChange={setForm}
        onSubmit={handleSubmit}
        onClearQuote={handleClearQuote}
        canClearQuote={result !== null || error !== null || hasFilledStops}
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
        planningMarkers={planningMarkers(form.stops)}
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
