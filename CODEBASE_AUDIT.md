# TMT Calc — Codebase Audit

Date: 2026-07-03
Scope: full backend (HERE integration, RouteFacts extraction, polyline decoding, Alps detection, pricing, API routes, tests).

## Executive summary

The codebase was structurally sound (clean separation of HERE client / extraction / pricing / routes, good defensive parsing, no key leakage), but one **spec violation in the flexible-polyline decoder corrupted every real HERE polyline**, which broke polyline-based Alps tunnel detection at runtime and spawned a cascade of compensating hacks (lat/lng swap heuristics, magnitude rescaling, first-point lng patching). A second, independent bug made **PL → UK quotes fail with `NO_MODEL_AVAILABLE`**. Both are fixed with minimal changes; 287 tests pass including 10 new golden end-to-end cases.

## What currently works (verified)

- `GET /health` returns `{ ok: true }`.
- `POST /api/route-facts` and `POST /api/quote` accept `origin`/`destination`/`via`|`waypoints` as address or lat/lng, plus `vehicleProfileId`.
- HERE request builder is Routing-v8 compliant: `return=summary,tolls,polyline,actions` (no `notices`, no `spans`), `via=<lat>,<lng>!passThrough=true`, `vehicle[grossWeight]` in kg, `vehicle[height|width|length]` in cm, `vehicle[axleCount]`; no `truck[...]`/`vehicle[...]` mixing.
- Geocoding/reverse geocoding with 7-day LRU cache; country codes come from the geocoder (alpha-3 from HERE), normalized to alpha-2 in RouteFacts.
- `isInternational`, `isEU`, UK detection (GB/GBR/UK → GB), ferry detection (section type/mode + action text), toll extraction, truck-restriction warnings → `regulatory.*`, raw HERE warnings preserved.
- Waypoint-proximity fallback for Fréjus/Mont Blanc (≤3 km from tunnel centers).
- HTTP client: timeouts, retry with backoff, API-key sanitization in errors and logs; upstream failures return structured JSON (`502 UPSTREAM_ERROR`), not socket hang-ups.
- Pricing engine with explainable line items (`kmCharge`, `emptiesCharge`, `surcharges[]`, `minimumAdjustment`).

## What was broken, root causes, and fixes

### 1. Flexible polyline decoder skipped the format-version varint (CRITICAL)

- **Files:** `src/here/flexible-polyline.ts` (`decodeFlexiblePolyline`, `encodeFlexiblePolyline`)
- **Root cause:** Per the [flexible-polyline spec](https://github.com/heremaps/flexible-polyline), the stream is `<version=1><header content><deltas…>`. The decoder read the *version* byte as the header, so precision decoded as 1 (factor 10 instead of 10⁵) and the real header content was consumed as the first delta-lat. Every subsequent value shifted one slot — producing exactly the reported corruption: `decodedFirstTwoPoints[0] = { lat: 45.062355, lng: 0.000003 }`, swapped lat/lng, implausible bounds, `minLng = 0`.
- **Why tests didn't catch it:** the project's own encoder had the *same* deviation (no version byte), so encode→decode round-trip tests passed; the official reference vector `BFoz5xJ67i1B1B7PzIhaxL7Y` was only asserted for "points exist", not values.
- **Consequences:** polyline bounds were always implausible for real HERE responses → Alps bbox detection never ran → detection silently degraded to the waypoint-proximity fallback only; the swap/rescale/lng-patch hacks were added to compensate.
- **Fix:** decoder now reads `<version><header>` per spec (rejects unknown versions); encoder writes the version byte (output now starts with `BF…` like real HERE polylines). The reference-vector test asserts exact coordinates. The defensive swap/patch heuristics are retained as no-op safety nets and their debug fields still show before/after state.

### 2. PL → UK (and any EU-lane model with a UK destination) → `NO_MODEL_AVAILABLE` (HIGH)

- **Files:** `src/pricing/types.ts` (`countryMatchesGroup`)
- **Root cause:** the `EU` lane group matched only EU member states, but GB is not in the EU set. `solo-pl-eu` (lane PL→EU) therefore never matched UK destinations — even though it carries a `ukFerry +400` surcharge, and other EU-lane models carry `ukMin`, which was dead configuration.
- **Fix:** the `EU` lane group now also matches UK codes (documented as "European coverage"); UK-specific pricing is applied via the `ukFerry` surcharge and `ukMin` minimums. More specific UK lanes (e.g. `solo-it-uk`) are ordered first and still win.

### 3. Alps surcharge condition was over-constrained (MEDIUM)

- **Files:** `src/pricing/engine.ts` (`calculatePrice`)
- **Root cause:** the `alpsTunnel` surcharge required `riskFlags.crossesAlps && tunnels[] contains Fréjus/Mont Blanc by name`. The extractor sets both together, but the spec is "+200 when `crossesAlps` is true"; the redundant name check could suppress the surcharge if the tunnel list ever diverged.
- **Fix:** surcharge keys on `riskFlags.crossesAlps` directly (which the extractor sets only for Fréjus/Mont Blanc via polyline bbox or waypoint proximity — text mentions alone do not set it, preserving the existing "no surcharge from action text" behavior).

### 4. ~90 lines of country-normalization logic duplicated across route handlers (MEDIUM, maintainability)

- **Files:** `src/routes/route-facts.ts`, `src/routes/quote.ts`
- **Root cause:** `toAlpha2`, `isUkCode`, `isEuCountry`, EU set, and the whole geography-enrichment block were copy-pasted into both handlers (already drifting: one had debug logging the other lacked).
- **Fix:** extracted to `src/routes/geography.ts` (`applyResolvedGeography()` + helpers); both handlers use it. The pricing selector consumes this normalized RouteFacts geography — no duplicate country inference in pricing.

### 5. Noisy `console.log` debug output in the quote handler (LOW)

- **Files:** `src/routes/quote.ts`
- **Fix:** removed `[DEBUG /api/quote] …` console logging; all diagnostics remain in the structured `debug` response payload (masked URLs only, no API keys).

### 6. Stale test fixtures encoded with the non-compliant encoder (test debt)

- **Files:** `src/here/route-truck.test.ts`, `src/here/flexible-polyline.test.ts`
- **Fix:** fixtures re-encoded with the spec-compliant encoder (they gain the leading `B` version byte); the reference-vector test now asserts exact decoded coordinates; added a test that unknown format versions are rejected.

## Tests added

- `src/routes/golden-quotes.test.ts` — 10 end-to-end tests that mock **only the HTTP layer** and run the real geocode → route → decode → extract → price pipeline:
  - **A** Poznań→Verona: `solo-pl-eu`, PL→IT, `finalPrice = distanceKm + 200` (1100 km → 1300 EUR), no `NO_MODEL_AVAILABLE`.
  - **B** Verona→Munich: `solo-it-eu`, `kmCharge = km × 1.2`, empties 200, minimum 1200 applied (430 km → 1200 EUR, `minimumAdjustment` 484).
  - **C** Verona→London: `solo-it-uk`, GBR→GB normalization, ferry detected, `ukFerry +400`, minimum 2700 applied.
  - **D** Turin→(Bardonecchia, Modane)→Chambéry: `viaCount=2`, `via=<lat>,<lng>!passThrough=true` on the wire, Fréjus detected with `alpsMatchReason=polylineBbox`, `crossesAlps=true`, `hasTunnel=true`, tunnels include Fréjus, `alpsTunnel +200`, `polylineFirstPoint.lng ≈ 7.68` (not 0), `polylineBounds.minLng ≈ 5.92 > 5`, no swap/patch applied, masked URL has no API key.
  - **E** Robustness: missing tolls/actions/polyline → 200; malformed toll entries → 200; upstream 500 → structured `502 UPSTREAM_ERROR` JSON without the key; geocoder no-results → structured error.
- `src/pricing/engine.test.ts` — PL→UK matches `solo-pl-eu` with +400 (2100 EUR for 1500 km); IT→UK still prefers `solo-it-uk`; `crossesAlps=true` ⇒ +200; Brenner-only route ⇒ no surcharge.
- `src/here/flexible-polyline.test.ts` — official reference vector asserted to exact values; version-byte encoding asserted; unsupported version rejected.

## Verification performed

- `npm test`: **287/287 pass** (12 files).
- `npm run build` (tsc): clean.
- Manual curl verification against the real app (HERE HTTP layer stubbed with canned v8 responses, no live key available in this environment): `/health`, and scenarios A–D all return the expected models, prices, flags, and debug fields listed above.

## Risks / assumptions

- **`EU` lane group now includes UK.** This is the coherent reading of the model config (every EU-lane model ships UK surcharges/minimums), and it enables `van-eu-eu` / `ftl-*-eu` to quote UK destinations too (with their configured UK surcharges). If a lane must exclude UK, introduce a dedicated group.
- **Live HERE responses were not exercised** (no `HERE_API_KEY` in this environment). The decoder is validated against the official spec reference vector, and all request parameters match documented v8 behavior, but a smoke test with a real key is recommended (see README for curl commands).
- The salvage heuristics (lat/lng swap, magnitude rescale, first-point lng patch) are retained for defense in depth. They only trigger on grossly implausible geometry and are fully surfaced in `debug` (`polylineSwapApplied`, `firstPointLngPatched`, `firstPointLngPatchReason`, before/after points), so genuine decoder regressions remain visible.
- Country inference relies on geocoder country codes for origin/destination and toll data for transit countries; transit countries may be incomplete on toll-free routes (documented limitation, does not affect pricing lanes which use origin/destination only).
- `weekend` / `unloadingAfter14` surcharges remain TODO stubs (accepted in the request schema, not yet applied) — unchanged behavior.

## How to run locally

```bash
npm install
cp .env.example .env      # set HERE_API_KEY=<your key>
npm run dev               # dev server on :3000
npm test                  # unit + golden tests (no live HERE calls)
npm run build && npm start
```

Example curl commands are in `README.md` (health, route-facts, quote, and the four golden scenarios).
