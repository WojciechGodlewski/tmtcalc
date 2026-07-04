import { useState } from 'react';
import { requestQuote } from './api';
import type { QuoteRequest, QuoteResponse } from './types';
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
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QuoteResponse | null>(null);
  const [resultSeq, setResultSeq] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  async function handleSubmit() {
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

    // Comma-separated codes -> array; tolerant of whitespace and case
    const excludeCountries = form.excludeCountriesText
      .split(',')
      .map((code) => code.trim().toUpperCase())
      .filter((code) => code.length > 0);

    const payload: QuoteRequest = {
      origin: { address: origin },
      destination: { address: destination },
      ...(via.length > 0 ? { via } : {}),
      vehicleProfileId: form.vehicleProfileId,
      includeGeometry: true,
      ...(excludeCountries.length > 0 ? { excludeCountries } : {}),
    };

    setLoading(true);
    setError(null);
    try {
      const response = await requestQuote(payload);
      setResult(response);
      setResultSeq((seq) => seq + 1);
    } catch (err) {
      setResult(null);
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>TMT Calc</h1>
        <p className="subtitle">Transport quote calculator</p>
      </header>

      <QuoteForm form={form} loading={loading} onChange={setForm} onSubmit={handleSubmit} />

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

      {!loading && result && (
        <>
          {/* Hierarchy: hard status banner -> map -> quote -> facts -> debug */}
          <AdmissibilityBanner
            admissibility={result.admissibility}
            excludedCountries={result.debug?.hereRequest?.excludeCountries ?? []}
          />
          {/* key remounts the map per result so it initializes exactly once
              per result/container lifecycle and disposes cleanly */}
          <RouteMap
            key={resultSeq}
            geometry={result.routeGeometry}
            resolvedPoints={result.debug?.resolvedPoints}
            restrictionSegments={result.routeFacts.regulatory.restrictionSegments}
          />
          <QuoteResult result={result} />
          <RouteFactsPanel routeFacts={result.routeFacts} />
          <DebugPanel debug={result.debug} />
        </>
      )}
    </div>
  );
}
