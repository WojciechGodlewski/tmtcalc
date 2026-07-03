import type { QuoteDebug } from '../types';

interface DebugPanelProps {
  debug: QuoteDebug | undefined;
}

/**
 * Collapsible technical debug view, hidden by default.
 * Renders a curated subset of the backend debug payload. The backend never
 * includes the HERE API key (URLs are masked server-side), and this panel
 * additionally only shows the whitelisted fields below.
 */
export function DebugPanel({ debug }: DebugPanelProps) {
  if (!debug) return null;

  const selected = {
    resolvedPoints: debug.resolvedPoints,
    hereRequest: {
      viaCount: debug.hereRequest?.viaCount,
    },
    hereResponse: {
      alpsMatch: debug.hereResponse?.alpsMatch,
      alpsMatchReason: debug.hereResponse?.alpsMatchReason,
      polylineFirstPoint: debug.hereResponse?.polylineFirstPoint,
      polylineBounds: debug.hereResponse?.polylineBounds,
      polylineSwapApplied: debug.hereResponse?.polylineSwapApplied,
      firstPointLngPatched: debug.hereResponse?.firstPointLngPatched,
    },
  };

  return (
    <details className="card debug-panel">
      <summary>Technical debug</summary>
      <pre>{JSON.stringify(selected, null, 2)}</pre>
    </details>
  );
}
