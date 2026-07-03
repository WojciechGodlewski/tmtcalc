import { useEffect, useRef, useState } from 'react';
import { loadHereMaps } from '../here-maps-loader';
import type { ResolvedPoints, RouteGeometry } from '../types';

/**
 * Browser-side HERE Maps key (separate, restricted key - NOT the backend
 * HERE_API_KEY). Missing key degrades gracefully: the quote UI keeps working
 * and the map area shows a configuration note instead.
 */
const MAPS_KEY: string | undefined = import.meta.env.VITE_HERE_MAPS_API_KEY;

const ROUTE_STYLE = { strokeColor: '#1f5fbf', lineWidth: 5 };

interface RouteMapProps {
  geometry: RouteGeometry | undefined;
  resolvedPoints: ResolvedPoints | undefined;
}

function markerSvg(fill: string, label: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="34" viewBox="0 0 26 34">` +
    `<path d="M13 0C5.8 0 0 5.8 0 13c0 9.7 13 21 13 21s13-11.3 13-21C26 5.8 20.2 0 13 0z" fill="${fill}"/>` +
    `<text x="13" y="18" font-size="12" font-family="Arial" font-weight="bold" fill="#fff" text-anchor="middle">${label}</text>` +
    `</svg>`
  );
}

export function RouteMap({ geometry, resolvedPoints }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!MAPS_KEY || !geometry || !containerRef.current) {
      return;
    }

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
          }
        );

        // Pan/zoom behavior + default UI controls
        new H.mapevents.Behavior(new H.mapevents.MapEvents(map));
        H.ui.UI.createDefault(map, layers);

        // Route polyline
        const lineString = new H.geo.LineString();
        for (const p of geometry.points) {
          lineString.pushPoint({ lat: p.lat, lng: p.lng });
        }
        map.addObject(new H.map.Polyline(lineString, { style: ROUTE_STYLE }));

        // Markers: origin (A) / destination (B) from resolved points when
        // available, otherwise the route endpoints; numbered via waypoints.
        const first = geometry.points[0];
        const last = geometry.points[geometry.points.length - 1];
        const origin = resolvedPoints?.origin ?? first;
        const destination = resolvedPoints?.destination ?? last;

        const addMarker = (lat: number, lng: number, fill: string, label: string) => {
          const icon = new H.map.Icon(markerSvg(fill, label), { anchor: { x: 13, y: 34 } });
          map!.addObject(new H.map.Marker({ lat, lng }, { icon }));
        };

        addMarker(origin.lat, origin.lng, '#1d7a3e', 'A');
        addMarker(destination.lat, destination.lng, '#9c2b2b', 'B');
        (resolvedPoints?.waypoints ?? []).forEach((wp, i) => {
          addMarker(wp.lat, wp.lng, '#1f5fbf', String(i + 1));
        });

        // Fit viewport to the route bounds
        const rect = new H.geo.Rect(
          geometry.bounds.maxLat,
          geometry.bounds.minLng,
          geometry.bounds.minLat,
          geometry.bounds.maxLng
        );
        map.getViewModel().setLookAtData({ bounds: rect }, false);

        resizeHandler = () => map?.getViewPort().resize();
        window.addEventListener('resize', resizeHandler);
      } catch {
        if (!disposed) setLoadFailed(true);
      }
    })();

    return () => {
      disposed = true;
      if (resizeHandler) window.removeEventListener('resize', resizeHandler);
      if (map) map.dispose();
    };
  }, [geometry, resolvedPoints]);

  if (!MAPS_KEY) {
    return (
      <div className="card map-note">
        HERE map key is not configured. Quote calculation still works.
      </div>
    );
  }

  if (!geometry) {
    return <div className="card map-note">Map geometry unavailable for this quote.</div>;
  }

  if (loadFailed) {
    return (
      <div className="card map-note">
        Map failed to load from HERE. Quote calculation still works.
      </div>
    );
  }

  return (
    <div className="card map-card">
      <h3>Route map</h3>
      <div ref={containerRef} className="route-map" />
      {geometry.simplified && (
        <p className="muted map-footnote">
          Route shape simplified to {geometry.pointCount} points for display.
        </p>
      )}
    </div>
  );
}
