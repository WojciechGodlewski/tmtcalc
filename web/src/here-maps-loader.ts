/**
 * Runtime loader for the HERE Maps API for JavaScript (v3.1).
 *
 * The API is loaded from HERE's CDN (the officially documented integration)
 * only when a map key is configured and a map is actually rendered, so the
 * app bundle stays small and works fully without the key. Map tiles are
 * fetched by the browser directly from HERE - never proxied via our backend.
 */

const HERE_JS_BASE = 'https://js.api.here.com/v3/3.1';

// Order matters: core must load before the dependent modules.
const SCRIPT_URLS = [
  `${HERE_JS_BASE}/mapsjs-core.js`,
  `${HERE_JS_BASE}/mapsjs-service.js`,
  `${HERE_JS_BASE}/mapsjs-ui.js`,
  `${HERE_JS_BASE}/mapsjs-mapevents.js`,
];

const CSS_URL = `${HERE_JS_BASE}/mapsjs-ui.css`;

let loadPromise: Promise<typeof H> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function injectCss(): void {
  if (document.querySelector(`link[href="${CSS_URL}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CSS_URL;
  document.head.appendChild(link);
}

/** Load the HERE Maps JS API once; subsequent calls reuse the same promise. */
export function loadHereMaps(): Promise<typeof H> {
  if (typeof window !== 'undefined' && window.H?.Map) {
    return Promise.resolve(window.H);
  }
  if (!loadPromise) {
    loadPromise = (async () => {
      injectCss();
      for (const src of SCRIPT_URLS) {
        await loadScript(src);
      }
      if (!window.H?.Map) {
        throw new Error('HERE Maps API did not initialize');
      }
      return window.H;
    })().catch((err) => {
      // Allow a retry on the next mount instead of caching the failure forever
      loadPromise = null;
      throw err;
    });
  }
  return loadPromise;
}

declare global {
  interface Window {
    H: typeof H;
  }
}
