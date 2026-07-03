/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * HERE Maps API for JavaScript browser key. This is a SEPARATE, restricted
   * key for map rendering only - never the backend HERE_API_KEY. Browser keys
   * are visible in the bundle by nature; restrict it in the HERE platform.
   */
  readonly VITE_HERE_MAPS_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
