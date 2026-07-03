import type { RouteFacts } from '../types';

function YesNo({ value }: { value: boolean | null }) {
  if (value === null) return <span className="muted">unknown</span>;
  return value ? <span className="flag-yes">yes</span> : <span className="flag-no">no</span>;
}

interface RouteFactsPanelProps {
  routeFacts: RouteFacts;
}

export function RouteFactsPanel({ routeFacts }: RouteFactsPanelProps) {
  const { geography, infrastructure, regulatory, riskFlags } = routeFacts;
  const tunnelNames = infrastructure.tunnels
    .map((t) => t.name)
    .filter((name): name is string => Boolean(name));

  return (
    <div className="card">
      <h3>Route facts</h3>
      <dl className="facts-grid">
        <div>
          <dt>International</dt>
          <dd><YesNo value={geography.isInternational} /></dd>
        </div>
        <div>
          <dt>Countries crossed</dt>
          <dd>{geography.countriesCrossed.length > 0 ? geography.countriesCrossed.join(', ') : '–'}</dd>
        </div>
        <div>
          <dt>UK route</dt>
          <dd><YesNo value={riskFlags.isUK} /></dd>
        </div>
        <div>
          <dt>Ferry</dt>
          <dd>
            <YesNo value={infrastructure.hasFerry} />
            {infrastructure.hasFerry && infrastructure.ferrySegments > 0 && (
              <span className="muted"> ({infrastructure.ferrySegments} segment{infrastructure.ferrySegments > 1 ? 's' : ''})</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Toll roads</dt>
          <dd>
            <YesNo value={infrastructure.hasTollRoads} />
            {infrastructure.tollCountries.length > 0 && (
              <span className="muted"> ({infrastructure.tollCountries.join(', ')})</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Crosses Alps (Fréjus / Mont Blanc)</dt>
          <dd><YesNo value={riskFlags.crossesAlps} /></dd>
        </div>
        <div>
          <dt>Tunnel</dt>
          <dd>
            <YesNo value={infrastructure.hasTunnel} />
            {tunnelNames.length > 0 && <span className="muted"> ({tunnelNames.join(', ')})</span>}
          </dd>
        </div>
      </dl>

      {regulatory.truckRestricted && (
        <div className="warning-box">
          <strong>Truck restriction warning</strong>
          <ul>
            {regulatory.restrictionReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
