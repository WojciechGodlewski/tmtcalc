import type { RestrictionSegment, RouteFacts } from '../types';

function formatCoord(p: { lat: number; lng: number } | null): string {
  if (!p) return 'n/a';
  return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
}

/** Readable "near" text: HERE label, or composed from components, or null */
function nearText(segment: RestrictionSegment): string | null {
  const loc = segment.location;
  if (!loc) return null;
  if (loc.label) return loc.label;
  const composed = [loc.city ?? loc.district ?? loc.county, loc.state, loc.countryCode]
    .filter(Boolean)
    .join(', ');
  return composed || null;
}

function RestrictionSegmentItem({ segment }: { segment: RestrictionSegment }) {
  const near = nearText(segment);
  // Normalized user-facing text from the backend. Raw HERE syntax (encoded
  // schedules, internal codes) never renders here - it lives in debug only.
  // Fallbacks cover older backend responses without a display object.
  const severityLabel = segment.display?.severityLabel ?? segment.severity;
  const title = segment.display?.title ?? segment.restrictionSummary;
  const message = segment.display?.message ?? null;

  return (
    <li className="restriction-segment">
      <div className="restriction-segment-head">
        <span className={`severity-badge severity-${severityLabel}`}>{severityLabel}</span>
        <strong>{title}</strong>
      </div>
      {near && (
        <div className="restriction-near">
          Near: <strong>{near}</strong>
        </div>
      )}
      <div className="restriction-segment-meta">
        {segment.approxDistanceFromOriginKm != null && (
          <span>Approx. {segment.approxDistanceFromOriginKm} km from origin</span>
        )}
        <span>
          Start: {formatCoord(segment.startPoint)} · End: {formatCoord(segment.endPoint)}
        </span>
      </div>
      {message && <p className="restriction-message">{message}</p>}
      {segment.display?.rawDetailsHidden && (
        <p className="restriction-note muted">Detailed schedule not decoded. Verify manually.</p>
      )}
    </li>
  );
}

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
          <p className="restriction-intro">
            The calculated route contains at least one segment that violates a
            restriction for the selected vehicle. Verify this segment manually
            before using the route operationally.
          </p>
          {regulatory.restrictionSegments && regulatory.restrictionSegments.length > 0 ? (
            <ul className="restriction-segments">
              {regulatory.restrictionSegments.map((segment, i) => (
                <RestrictionSegmentItem key={`${segment.sectionIndex}-${segment.spanStartOffset}-${i}`} segment={segment} />
              ))}
            </ul>
          ) : (
            <ul>
              {regulatory.restrictionReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
