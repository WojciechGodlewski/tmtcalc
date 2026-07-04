import type { QuoteResponse } from '../types';

function formatEur(value: number): string {
  return value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' EUR';
}

/** Surcharge types visually highlighted in the line items table. */
const HIGHLIGHTED_SURCHARGES = new Set(['ukFerry', 'alpsTunnel']);

interface QuoteResultProps {
  result: QuoteResponse;
}

export function QuoteResult({ result }: QuoteResultProps) {
  const { quote, routeFacts } = result;
  if (!quote) return null;
  const { lineItems } = quote;
  const geo = routeFacts.geography;
  const excludedCountries = result.debug?.hereRequest?.excludeCountries ?? [];
  // quoteValid=false (e.g. truck_restricted): the price is shown only as a
  // diagnostic figure, visually de-emphasized and explicitly labeled.
  const diagnosticOnly = (result.admissibility?.quoteValid ?? true) === false;

  return (
    <div className={`card quote-card${diagnosticOnly ? ' quote-card-diagnostic' : ''}`}>
      {diagnosticOnly && (
        <div className="diagnostic-label">Indicative only — not valid for operational use.</div>
      )}
      <div className="quote-header">
        <div>
          <div className={diagnosticOnly ? 'quote-price quote-price-diagnostic' : 'quote-price'}>
            {formatEur(quote.finalPrice)}
          </div>
          <div className="quote-model">
            {quote.modelName} <span className="badge">{quote.modelId}</span>
          </div>
        </div>
        <dl className="quote-summary">
          <div>
            <dt>Route</dt>
            <dd>
              {geo.originCountry ?? '?'} → {geo.destinationCountry ?? '?'}
            </dd>
          </div>
          <div>
            <dt>Distance</dt>
            <dd>{routeFacts.route.distanceKm.toLocaleString('en-GB')} km</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{routeFacts.route.durationHours != null ? `${routeFacts.route.durationHours} h` : '–'}</dd>
          </div>
        </dl>
      </div>

      {excludedCountries.length > 0 && (
        <p className="excluded-countries">
          Excluded countries: <strong>{excludedCountries.join(', ')}</strong>
        </p>
      )}

      <h3>Line items</h3>
      <table className="line-items">
        <tbody>
          <tr>
            <td>Km charge</td>
            <td className="num">{formatEur(lineItems.kmCharge)}</td>
          </tr>
          <tr>
            <td>Empties charge</td>
            <td className="num">{formatEur(lineItems.emptiesCharge)}</td>
          </tr>
          {lineItems.surcharges.map((s) => (
            <tr key={s.type} className={HIGHLIGHTED_SURCHARGES.has(s.type) ? 'surcharge-highlight' : undefined}>
              <td>
                {s.description} <span className="badge">{s.type}</span>
              </td>
              <td className="num">{formatEur(s.amount)}</td>
            </tr>
          ))}
          {lineItems.minimumAdjustment != null && (
            <tr>
              <td>Minimum price adjustment</td>
              <td className="num">{formatEur(lineItems.minimumAdjustment)}</td>
            </tr>
          )}
          <tr className="total-row">
            <td>Final price</td>
            <td className="num">{formatEur(quote.finalPrice)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
