import { useEffect, useRef, useState } from 'react';
import { loadHereMaps } from '../here-maps-loader';
import type { ResolvedPoints, RestrictionSegment, RouteGeometry } from '../types';
import type { PlanningMarker } from '../route-stops';

/**
 * Browser-side HERE Maps key (separate, restricted key - NOT the backend
 * HERE_API_KEY). Missing key degrades gracefully: the quote UI keeps working,
 * click-to-plan is simply unavailable, and after a result the map area shows
 * a configuration note instead.
 */
const MAPS_KEY: string | undefined = import.meta.env.VITE_HERE_MAPS_API_KEY;

const ROUTE_STYLE = { strokeColor: '#1f5fbf', lineWidth: 5 };
const RESTRICTION_STYLE = { strokeColor: '#c62828', lineWidth: 7 };

/** Default view while planning: central Europe */
const DEFAULT_VIEW = { lat: 48.5, lng: 10, zoom: 5 };

interface RouteMapProps {
  /** Result geometry; undefined while planning or when unavailable */
  geometry: RouteGeometry | undefined;
  resolvedPoints: ResolvedPoints | undefined;
  restrictionSegments?: RestrictionSegment[];
  /** Clicked map stops with pre-computed roles (A/1/2/B) */
  planningMarkers: PlanningMarker[];
  /** Called with the tapped coordinate; absence disables click capture */
  onMapClick?: (point: { lat: number; lng: number }) => void;
  /** True when a quote result is being displayed */
  hasResult: boolean;
}

function markerSvg(fill: string, label: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="34" viewBox="0 0 26 34">` +
    `<path d="M13 0C5.8 0 0 5.8 0 13c0 9.7 13 21 13 21s13-11.3 13-21C26 5.8 20.2 0 13 0z" fill="${fill}"/>` +
    `<text x="13" y="18" font-size="12" font-family="Arial" font-weight="bold" fill="#fff" text-anchor="middle">${label}</text>` +
    `</svg>`
  );
}

/** Marker fill for a planning role: A green, B red, vias blue */
function roleFill(role: string): string {
  if (role === 'A') return '#1d7a3e';
  if (role === 'B') return '#9c2b2b';
  return '#1f5fbf';
}

/** Index of the geometry point closest to the given coordinate (squared-degree metric) */
function nearestIndex(points: Array<{ lat: number; lng: number }>, target: { lat: number; lng: number }): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dLat = points[i].lat - target.lat;
    const dLng = points[i].lng - target.lng;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Points to draw for a restriction segment overlay: the slice of the
 * (possibly simplified) route geometry between the points nearest to the
 * segment start/end, or a direct start-end line as a fallback.
 */
function restrictionOverlayPoints(
  geometry: RouteGeometry,
  segment: RestrictionSegment
): Array<{ lat: number; lng: number }> | null {
  if (!segment.startPoint || !segment.endPoint) return null;
  const from = nearestIndex(geometry.points, segment.startPoint);
  const to = nearestIndex(geometry.points, segment.endPoint);
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const slice = geometry.points.slice(lo, hi + 1);
  if (slice.length >= 2) return slice;
  return [segment.startPoint, segment.endPoint];
}

export function RouteMap({
  geometry,
  resolvedPoints,
  restrictionSegments,
  planningMarkers,
  onMapClick,
  hasResult,
}: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<H.Map | null>(null);
  const resultGroupRef = useRef<H.map.Group | null>(null);
  const planGroupRef = useRef<H.map.Group | null>(null);
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const [mapReady, setMapReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  // Initialize the map exactly once for the component lifetime.
  useEffect(() => {
    if (!MAPS_KEY || !containerRef.current) return;

    let disposed = false;
    let map: H.Map | undefined;
    let resizeHandler: (() => void) | undefined;

    (async () => {
      try {
        const H = await loadHereMaps();
        if (disposed || !containerRef.current) return;

        const platform = new H.service.Platform({ apikey: MAPS_KEY });
        const layers = platform.createDefaultLayers();

        map = new H.Map(
          containerRef.current,
          (layers as { vector: { normal: { map: H.map.layer.Layer } } }).vector.normal.map,
          {
            pixelRatio: window.devicePixelRatio || 1,
            padding: { top: 40, right: 40, bottom: 40, left: 40 },
            center: { lat: DEFAULT_VIEW.lat, lng: DEFAULT_VIEW.lng },
            zoom: DEFAULT_VIEW.zoom,
          }
        );

        // Pan/zoom behavior + default UI controls
        new H.mapevents.Behavior(new H.mapevents.MapEvents(map));
        H.ui.UI.createDefault(map, layers);

        // Object groups: result rendering and planning markers, redrawn
        // independently without recreating the map.
        const resultGroup = new H.map.Group();
        const planGroup = new H.map.Group();
        map.addObject(resultGroup);
        map.addObject(planGroup);

        // Click-to-plan: Behavior swallows drags, 'tap' fires on clicks only
        map.addEventListener('tap', ((evt: unknown) => {
          const handler = onMapClickRef.current;
          if (!handler || !map) return;
          const pointer = (evt as { currentPointer?: { viewportX: number; viewportY: number } })
            .currentPointer;
          if (!pointer) return;
          const geo = map.screenToGeo(pointer.viewportX, pointer.viewportY);
          if (geo) handler({ lat: geo.lat, lng: geo.lng });
        }) as unknown as EventListener);

        resizeHandler = () => map?.getViewPort().resize();
        window.addEventListener('resize', resizeHandler);

        mapRef.current = map;
        resultGroupRef.current = resultGroup;
        planGroupRef.current = planGroup;
        setMapReady(true);
      } catch {
        if (!disposed) setLoadFailed(true);
      }
    })();

    return () => {
      disposed = true;
      if (resizeHandler) window.removeEventListener('resize', resizeHandler);
      mapRef.current = null;
      resultGroupRef.current = null;
      planGroupRef.current = null;
      if (map) map.dispose();
    };
    // MAPS_KEY is constant for the app lifetime
  }, []);

  // Redraw the RESULT layer (route polyline, restriction overlays, markers)
  useEffect(() => {
    const map = mapRef.current;
    const group = resultGroupRef.current;
    if (!mapReady || !map || !group) return;

    group.removeAll();
    if (!geometry) return;

    const H = window.H;

    const lineString = new H.geo.LineString();
    for (const p of geometry.points) {
      lineString.pushPoint({ lat: p.lat, lng: p.lng });
    }
    group.addObject(new H.map.Polyline(lineString, { style: ROUTE_STYLE }));

    // Restriction segment overlays: only the affected spans in red
    for (const segment of restrictionSegments ?? []) {
      const overlay = restrictionOverlayPoints(geometry, segment);
      if (!overlay) continue;
      const overlayLine = new H.geo.LineString();
      for (const p of overlay) {
        overlayLine.pushPoint({ lat: p.lat, lng: p.lng });
      }
      group.addObject(new H.map.Polyline(overlayLine, { style: RESTRICTION_STYLE }));
    }

    // Markers: origin (A) / destination (B) / numbered waypoints
    const first = geometry.points[0];
    const last = geometry.points[geometry.points.length - 1];
    const origin = resolvedPoints?.origin ?? first;
    const destination = resolvedPoints?.destination ?? last;

    const addMarker = (lat: number, lng: number, fill: string, label: string) => {
      const icon = new H.map.Icon(markerSvg(fill, label), { anchor: { x: 13, y: 34 } });
      group.addObject(new H.map.Marker({ lat, lng }, { icon }));
    };

    addMarker(origin.lat, origin.lng, '#1d7a3e', 'A');
    addMarker(destination.lat, destination.lng, '#9c2b2b', 'B');
    (resolvedPoints?.waypoints ?? []).forEach((wp, i) => {
      addMarker(wp.lat, wp.lng, '#1f5fbf', String(i + 1));
    });

    // Fit viewport to the route bounds (only when a result arrives)
    const rect = new H.geo.Rect(
      geometry.bounds.maxLat,
      geometry.bounds.minLng,
      geometry.bounds.minLat,
      geometry.bounds.maxLng
    );
    map.getViewModel().setLookAtData({ bounds: rect }, false);
  }, [mapReady, geometry, resolvedPoints, restrictionSegments]);

  // Redraw the PLANNING layer (clicked points). Hidden while a result route
  // is displayed - the result markers already show A/1/2/B.
  useEffect(() => {
    const group = planGroupRef.current;
    if (!mapReady || !group) return;

    group.removeAll();
    if (geometry) return;

    const H = window.H;
    for (const marker of planningMarkers) {
      const icon = new H.map.Icon(markerSvg(roleFill(marker.role), marker.role), { anchor: { x: 13, y: 34 } });
      group.addObject(new H.map.Marker({ lat: marker.lat, lng: marker.lng }, { icon }));
    }
  }, [mapReady, planningMarkers, geometry]);

  // --- Render states ---

  if (!MAPS_KEY) {
    // Without a browser map key there is no map (and no click-to-plan);
    // show the configuration note only once a result exists.
    if (!hasResult) return null;
    return (
      <div className="card map-note">
        HERE map key is not configured. Quote calculation still works.
      </div>
    );
  }

  if (loadFailed) {
    if (!hasResult && planningMarkers.length === 0) return null;
    return (
      <div className="card map-note">
        Map failed to load from HERE. Quote calculation still works.
      </div>
    );
  }

  return (
    <div className="card map-card">
      <h3>Route map</h3>
      {hasResult && !geometry && (
        <p className="map-note-inline muted">Map geometry unavailable for this quote.</p>
      )}
      <div ref={containerRef} className="route-map" />
      <p className="map-hint muted">
        Click the map to add a route stop — it fills the first empty stop row, otherwise the click
        becomes the new destination.
      </p>
      {geometry?.simplified && (
        <p className="muted map-footnote">
          Route shape simplified to {geometry.pointCount} points for display.
        </p>
      )}
    </div>
  );
}
