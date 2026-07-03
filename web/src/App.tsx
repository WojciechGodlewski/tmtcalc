import { useState } from 'react';
import { requestQuote } from './api';
import type { QuoteRequest, QuoteResponse } from './types';
import { QuoteForm, type FormState } from './components/QuoteForm';
import { QuoteResult } from './components/QuoteResult';
import { RouteFactsPanel } from './components/RouteFactsPanel';
import { DebugPanel } from './components/DebugPanel';
import { ErrorMessage } from './components/ErrorMessage';

const INITIAL_FORM: FormState = {
  origin: '',
  destination: '',
  viaText: '',
  vehicleProfileId: 'solo_18t_23ep',
};

export function App() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QuoteResponse | null>(null);
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

    const payload: QuoteRequest = {
      origin: { address: origin },
      destination: { address: destination },
      ...(via.length > 0 ? { via } : {}),
      vehicleProfileId: form.vehicleProfileId,
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
          <QuoteResult result={result} />
          <RouteFactsPanel routeFacts={result.routeFacts} />
          <DebugPanel debug={result.debug} />
        </>
      )}
    </div>
  );
}
