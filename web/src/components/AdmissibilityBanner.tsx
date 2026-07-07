import type { Admissibility } from '../types';

interface AdmissibilityBannerProps {
  admissibility: Admissibility | undefined;
  excludedCountries: string[];
}

/**
 * Hard status banner - the first thing the user sees for a result.
 * Ferry/tunnel/toll are pricing components and never appear here;
 * this banner is exclusively about hard constraints.
 */
export function AdmissibilityBanner({ admissibility, excludedCountries }: AdmissibilityBannerProps) {
  // Older backend responses without admissibility: treat as valid
  const status = admissibility?.status ?? 'valid';

  if (status === 'valid') {
    return (
      <div className="card status-banner status-valid" role="status">
        <strong>Valid quote</strong>
        <span className="status-detail">
          Route found{excludedCountries.length > 0 ? ', country exclusions satisfied' : ''}, vehicle can
          pass, pricing model available.
        </span>
      </div>
    );
  }

  if (status === 'warning') {
    return (
      <div className="card status-banner status-warning" role="alert">
        <strong>Manual verification required</strong>
        <span className="status-detail">HERE returned truck-related warnings for this route.</span>
        {admissibility && admissibility.messages.length > 0 && (
          <ul className="status-messages">
            {admissibility.messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (status === 'truck_restricted') {
    return (
      <div className="card status-banner status-blocked" role="alert">
        <strong>Route found, but not valid for selected vehicle</strong>
        <span className="status-detail">
          The calculated route satisfies the requested country exclusions, but HERE reports vehicle
          restriction violations for the selected truck profile.
        </span>
        {admissibility && admissibility.messages.length > 0 && (
          <ul className="status-messages">
            {admissibility.messages.slice(1).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (status === 'pricing_unavailable') {
    return (
      <div className="card status-banner status-info" role="status">
        <strong>Route is valid, but no pricing model is available for this lane.</strong>
        {/* Backend messages name the exact lane, e.g. "No pricing model
            covers the lane DE → FR for vehicle solo_18t_23ep." */}
        {admissibility && admissibility.messages.length > 0 ? (
          <ul className="status-messages">
            {admissibility.messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : (
          <span className="status-detail">
            The route satisfies all hard constraints; only pricing coverage is missing.
          </span>
        )}
      </div>
    );
  }

  // no_route normally arrives as a structured error, not a 200 response
  return (
    <div className="card status-banner status-blocked" role="alert">
      <strong>
        {excludedCountries.length > 0
          ? 'No route found with selected country exclusions.'
          : 'No route found with selected constraints.'}
      </strong>
    </div>
  );
}
