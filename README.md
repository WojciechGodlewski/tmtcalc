# TMT Calc

Transport pricing calculator: Node/TypeScript backend (HERE Routing v8) plus a
small React web UI for the quoting workflow.

## Setup

```bash
# Install backend dependencies
npm install

# Install frontend dependencies
npm run web:install

# Copy environment template and add your HERE API key
cp .env.example .env
# Edit .env and set HERE_API_KEY=your_key_here
# HERE_API_KEY is only needed by the BACKEND for live HERE calls.
# NEVER commit .env or any secrets.

# Start backend API (http://localhost:3000)
npm run dev

# Start frontend dev server in another terminal (http://localhost:5173)
npm run web:dev

# Run backend tests
npm test

# Build everything for production
npm run build:all
npm start   # serves API + built UI on http://localhost:3000
```

## Web UI

The quote calculator UI lives in `web/` (Vite + React + TypeScript, plain CSS).

- **Dev:** run `npm run dev` (backend) and `npm run web:dev` (frontend). The
  Vite dev server on `http://localhost:5173` proxies `/api` and `/health` to
  the backend on port 3000, so there is no CORS setup and the frontend never
  sees any credentials.
- **Prod:** `npm run build:all` compiles the backend to `dist/` and the
  frontend to `web/dist/`. When `web/dist` exists, the backend serves it at
  `/` — one process, same origin for UI and API.
- **Usage:** enter origin and destination addresses, optionally add via
  waypoints (one per line), pick a vehicle profile, and click
  "Calculate quote". Preset buttons fill the form with the four golden
  scenarios (they don't auto-submit). Results show the price, explainable
  line items (UK and Alps surcharges highlighted), route facts, and a
  collapsible "Technical debug" section (hidden by default, masked URLs only,
  never any API key).
- The frontend calls the backend only for quotes; the backend HERE_API_KEY
  never reaches the browser.

### Route map (HERE Maps API for JavaScript)

After a successful quote the UI renders the route on a HERE base map: the
route polyline (from backend-decoded geometry), origin (A) and destination (B)
markers, numbered waypoint markers, and the viewport fitted to the route
bounds.

**Two separate HERE keys are involved — never mix them:**

| Key | Where | Purpose |
|-----|-------|---------|
| `HERE_API_KEY` | Backend only (`.env` / server env) | Geocoding, truck routing, tolls. Never sent to the browser. |
| `VITE_HERE_MAPS_API_KEY` | Frontend build (`web/.env`) | HERE Maps JS rendering only. Ships in the JS bundle, so it is browser-visible **by nature**. |

Setting up the map key:

1. In the [HERE platform](https://platform.here.com) create a **separate**
   API key for the Maps API for JavaScript (do **not** reuse the backend
   routing key), and restrict it (allowed domains, JS Maps API only).
2. `cp web/.env.example web/.env` and set `VITE_HERE_MAPS_API_KEY=<that key>`.
3. Never commit `web/.env` (it is gitignored, like all `.env` files).

Without the key the app still works fully — the map area just shows
"HERE map key is not configured. Quote calculation still works."

Map tiles are loaded by the browser directly from HERE's CDN
(`js.api.here.com`); they are never proxied through our backend.

**Verifying the map:** run the backend (`npm run dev`, with `HERE_API_KEY`)
and the frontend (`npm run web:dev`, with `web/.env` set), then click each of
the four presets and Calculate. Expect: the route drawn on the map, A/B
markers at the endpoints, viewport fitted to the route — and for
Turin → Chambéry, waypoint markers 1 (Bardonecchia) and 2 (Modane) with the
route through the Fréjus corridor. For production: `npm run build:all` (set
`VITE_HERE_MAPS_API_KEY` in `web/.env` before building) then `npm start`.

### Route admissibility and quote validity

TMT Calc evaluates **one requested route under the user's hard constraints**.
It never calculates baseline routes, route candidates, or recommended
alternatives that ignore those constraints. Hard constraint hierarchy:

1. the route must exist (origin / destination / via routable),
2. excluded countries must be avoided (strict, enforced before routing),
3. the selected vehicle must be able to pass the route,
4. only then is the price a **valid operational quote**.

Ferry / UK crossing / Alps tunnel / tolls / distance / duration / surcharges
/ minimum price are **pricing components** — they never block a route.

Every successful `/api/quote` response carries a top-level `admissibility`
object (the source of truth for validity):

| status | meaning | quoteValid | routeUsable |
|--------|---------|-----------|-------------|
| `valid` | all hard constraints satisfied, pricing model found | true | true |
| `warning` | route usable, but HERE returned truck-related notices → **manual verification required** | true | true |
| `truck_restricted` | HERE reports `violatedVehicleRestriction` for the selected vehicle → "Route found, but not valid for selected vehicle." | false | false |
| `pricing_unavailable` | route passes all hard constraints, but no pricing model exists for the lane/vehicle (no `quote` in the response) | false | true |
| `no_route` | represented by the structured `422 NO_ROUTE_FOUND` error response; message names country exclusions when they were requested | — | — |

Truck restriction decision rule (deterministic): a located restriction
segment with code `violatedVehicleRestriction` and severity `critical`, **or**
a `violatedVehicleRestriction` notice without span data, ⇒ `truck_restricted`
— HERE flags violated restrictions for the specific vehicle profile
explicitly, so this is a hard violation. Other truck-related notices without
that evidence ⇒ `warning`: the route and quote are delivered (safest
non-blocking interpretation) but the UI demands manual verification.

For `truck_restricted` responses the pricing breakdown is still included for
diagnostics (`quote.validForOperations: false`), and the UI labels it
"Indicative only — not valid for operational use." A route that avoids the
requested countries can therefore exist and still be invalid for the selected
vehicle — the exclusions were applied; the problem is vehicle passability.

### Country exclusion (avoid countries)

Both `POST /api/route-facts` and `POST /api/quote` accept an optional
`excludeCountries` field — a **strict** territory exclusion passed to HERE as
`exclude[countries]=<alpha-3 list>`. This is not a soft preference: HERE will
not route through the excluded countries at all.

```bash
# Verona -> Munich without exclusions (route typically goes via Austria)
curl -X POST http://localhost:3000/api/quote \
  -H "Content-Type: application/json" \
  -d '{
    "origin": { "address": "Verona, Italy" },
    "destination": { "address": "Munich, Germany" },
    "vehicleProfileId": "solo_18t_23ep"
  }'

# Verona -> Munich avoiding Switzerland
# The HERE request includes exclude[countries]=CHE; the route (and the map)
# reflect the recalculated path, which may be longer or different.
curl -X POST http://localhost:3000/api/quote \
  -H "Content-Type: application/json" \
  -d '{
    "origin": { "address": "Verona, Italy" },
    "destination": { "address": "Munich, Germany" },
    "vehicleProfileId": "solo_18t_23ep",
    "excludeCountries": ["CH"]
  }'
```

Input rules:

- Array of codes (`["CH", "AT"]`) or a comma-separated string (`"CH, AT"`).
- Alpha-2 and alpha-3 are both accepted and normalized to alpha-3 for HERE
  (`CH`/`CHE` → `CHE`); `UK` is an alias for `GBR`. Case-insensitive,
  whitespace-tolerant, duplicates removed.
- Supported countries: CH, AT, DE, PL, CZ, SK, FR, IT, GB/UK, NL, BE, ES, PT,
  SI, HR, HU, RO, BG, DK, SE, NO, FI (alpha-3 equivalents too). Anything else
  → `400 Unsupported exclude country code: XX`.
- Origin/destination inside an excluded country → `400` (`"Origin cannot be
  in an excluded country."` / `"Destination cannot be in an excluded
  country."`) **before** any HERE routing call.
- If no route exists under the exclusions, the API returns structured
  `422 NO_ROUTE_FOUND` JSON (strict exclusions can make routes impossible).

In the UI, use the "Avoid countries" field (e.g. `CH, AT`; the "Avoid CH"
button fills `CH` without submitting). The result card shows
`Excluded countries: CHE` and the map shows the recalculated route. The
normalized list sent to HERE is echoed in `debug.hereRequest.excludeCountries`.

### Truck restriction warnings

When HERE reports that the calculated route violates a restriction for the
selected vehicle (notice code `violatedVehicleRestriction`), the API and UI
surface it as a **warning — never as a quote failure**. These notices require
**manual operational verification**: HERE still returns a route, but a real
truck may not legally drive the flagged stretch.

Where possible, the affected segments are **located** on the route: the
backend requests `spans=notices` (a separate HERE Routing v8 query parameter —
`spans` is not a valid `return` value) and maps each span's polyline offsets
onto the decoded route. `routeFacts.regulatory.restrictionSegments` then
contains, per segment: severity, a human-readable `restrictionSummary`
(max gross weight / height / width / length / axle limits, time-dependent
restrictions), start/end coordinates, span offsets, and the approximate
distance from the origin. The UI lists each segment and highlights it in red
on the route map.

If HERE provides no span data for a notice, the UI falls back to the generic
restriction warning (`restrictionReasons`) — `truckRestricted` and the
warning always work regardless.

**Nearby location labels.** Each located restriction segment is additionally
reverse-geocoded from its **midpoint** so dispatchers see a readable
"Near: Brennero, Trentino-South Tyrol, Italy" instead of raw coordinates
only. Notes:

- "Near" labels are **approximate** (midpoint of the segment) — the exact
  start/end coordinates remain visible on the card for operational
  verification.
- Lookup is **best-effort**: it never affects quote validity or
  admissibility, and a failed/skipped lookup simply leaves `location: null`
  (the UI silently shows coordinates only).
- At most 5 segments per request are reverse-geocoded (the rest get
  `location: null`); near-identical midpoints are deduplicated within a
  request. Lookup stats are in
  `debug.hereResponse.restrictionLocationLookups`.
- Reverse geocoding runs on the **backend** using `HERE_API_KEY`; the
  frontend never calls HERE geocoding.

### Route geometry API

`POST /api/quote` accepts an optional `"includeGeometry": true` flag. The
response then contains a top-level `routeGeometry` field:

```json
{
  "routeGeometry": {
    "points": [{ "lat": 45.06236, "lng": 7.67994 }],
    "bounds": { "minLat": 45.06, "maxLat": 45.57, "minLng": 5.92, "maxLng": 7.68 },
    "pointCount": 7,
    "simplified": false
  }
}
```

Points come from the corrected, spec-compliant flexible-polyline decoding of
the HERE route (all sections). Routes longer than 1000 points are uniformly
downsampled (first and last point always preserved) and flagged
`"simplified": true`; `bounds` always covers the full route. Without the flag
the field is omitted entirely.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HERE_API_KEY` | Yes | API key for HERE geocoding and routing |
| `PORT` | No | Server port (default: 3000) |
| `HOST` | No | Server host (default: 0.0.0.0) |

## API Endpoints

### GET /health

Health check endpoint.

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "ok": true,
  "service": "tmtcalc"
}
```

### POST /api/route-facts

Calculate route facts for truck transport between two points.

#### Request Body

```json
{
  "origin": {
    "address": "Berlin, Germany",
    "lat": 52.52,
    "lng": 13.405
  },
  "destination": {
    "address": "Warsaw, Poland",
    "lat": 52.2297,
    "lng": 21.0122
  },
  "waypoints": [
    { "address": "Poznan, Poland" }
  ],
  "vehicleProfileId": "ftl_13_6_33ep"
}
```

**Location fields** - Either `address` OR both `lat`/`lng` are required:
- `address` (string): Address to geocode
- `lat` (number): Latitude (-90 to 90)
- `lng` (number): Longitude (-180 to 180)

**vehicleProfileId** (required):
- `van_8ep` - Van, 3.5t, 8 euro pallets
- `solo_18t_23ep` - Solo truck, 18t, 23 euro pallets
- `ftl_13_6_33ep` - Full truck load, 40t, 33 euro pallets

#### Examples

**Using coordinates:**
```bash
curl -X POST http://localhost:3000/api/route-facts \
  -H "Content-Type: application/json" \
  -d '{
    "origin": { "lat": 52.52, "lng": 13.405 },
    "destination": { "lat": 52.2297, "lng": 21.0122 },
    "vehicleProfileId": "ftl_13_6_33ep"
  }'
```

**Using addresses (geocoded automatically):**
```bash
curl -X POST http://localhost:3000/api/route-facts \
  -H "Content-Type: application/json" \
  -d '{
    "origin": { "address": "Berlin, Germany" },
    "destination": { "address": "Warsaw, Poland" },
    "vehicleProfileId": "van_8ep"
  }'
```

**With waypoints:**
```bash
curl -X POST http://localhost:3000/api/route-facts \
  -H "Content-Type: application/json" \
  -d '{
    "origin": { "address": "Munich, Germany" },
    "destination": { "address": "Milan, Italy" },
    "waypoints": [
      { "address": "Innsbruck, Austria" }
    ],
    "vehicleProfileId": "solo_18t_23ep"
  }'
```

#### Response

```json
{
  "routeFacts": {
    "route": {
      "distanceKm": 574,
      "durationHours": 6.5,
      "sections": 1
    },
    "geography": {
      "originCountry": "DE",
      "destinationCountry": "PL",
      "countriesCrossed": ["DE", "PL"],
      "isInternational": true,
      "isEU": true
    },
    "infrastructure": {
      "hasFerry": false,
      "ferrySegments": 0,
      "hasTollRoads": true,
      "tollCountries": ["DEU", "POL"],
      "tollCostEstimate": 45.50,
      "hasTunnel": false,
      "tunnels": []
    },
    "regulatory": {
      "truckRestricted": false,
      "restrictionReasons": [],
      "adrRequired": null,
      "lowEmissionZones": [],
      "weightLimitViolations": null
    },
    "riskFlags": {
      "isUK": false,
      "isIsland": false,
      "crossesAlps": false,
      "isScandinavia": false,
      "isBaltic": false
    },
    "raw": {
      "provider": "here",
      "hereRouteId": "route-123",
      "warnings": []
    }
  },
  "debug": {
    "resolvedPoints": {
      "origin": {
        "lat": 52.52,
        "lng": 13.405,
        "label": "Berlin, Germany",
        "source": "geocoded"
      },
      "destination": {
        "lat": 52.2297,
        "lng": 21.0122,
        "source": "provided"
      }
    }
  }
}
```

Note: `geography` country codes are always ISO 3166-1 **alpha-2** (`PL`, `IT`, `DE`, `GB`). `UK` and alpha-3 codes from HERE (`POL`, `GBR`, …) are normalized automatically.

### POST /api/quote

Calculate a market-based price for a route. Accepts the same payload as
`/api/route-facts` (with `via` as an accepted alias for `waypoints`) plus
optional pricing options (`pricingDateTime`, `unloadingAfter14`, `isWeekend`).

Returns `{ quote, routeFacts, debug }` where `quote` contains the selected
model and explainable line items:

```json
{
  "quote": {
    "modelId": "solo-it-eu",
    "modelName": "SOLO IT -> EU",
    "distanceKm": 430,
    "lineItems": {
      "kmCharge": 516,
      "emptiesCharge": 200,
      "surcharges": [],
      "minimumAdjustment": 484
    },
    "finalPrice": 1200,
    "currency": "EUR"
  }
}
```

#### Golden scenario examples (solo_18t_23ep)

```bash
# A. PL -> EU: price = (routeKm + 200 empty km) * 1.0 EUR/km
curl -X POST http://localhost:3000/api/quote \
  -H "Content-Type: application/json" \
  -d '{
    "origin": { "address": "Poznań, Poland" },
    "destination": { "address": "Verona, Italy" },
    "vehicleProfileId": "solo_18t_23ep"
  }'

# B. IT -> EU: price = routeKm * 1.2 + 200 flat empties, minimum 1200 EUR
curl -X POST http://localhost:3000/api/quote \
  -H "Content-Type: application/json" \
  -d '{
    "origin": { "address": "Verona, Italy" },
    "destination": { "address": "Munich, Germany" },
    "vehicleProfileId": "solo_18t_23ep"
  }'

# C. IT -> UK: + 400 EUR UK crossing, minimum 2700 EUR
curl -X POST http://localhost:3000/api/quote \
  -H "Content-Type: application/json" \
  -d '{
    "origin": { "address": "Verona, Italy" },
    "destination": { "address": "London, United Kingdom" },
    "vehicleProfileId": "solo_18t_23ep"
  }'

# D. IT -> FR via Fréjus: + 200 EUR Alps tunnel surcharge
#    (debug.hereResponse.alpsMatchReason shows polylineBbox or waypointProximity)
curl -X POST http://localhost:3000/api/quote \
  -H "Content-Type: application/json" \
  -d '{
    "origin": { "address": "Turin, Italy" },
    "via": [
      { "address": "Bardonecchia, Italy" },
      { "address": "Modane, France" }
    ],
    "destination": { "address": "Chambéry, France" },
    "vehicleProfileId": "solo_18t_23ep"
  }'
```

## Live smoke tests

`npm run smoke:live` verifies the four golden scenarios above against the
**real HERE API** through a locally running backend and exits non-zero if any
expected field (model, countries, surcharges, minimums, Alps/polyline debug
fields) does not match:

```bash
# HERE_API_KEY must be available to the backend - either exported in the
# environment or set in .env (the app loads it via dotenv):
#   cp .env.example .env   # then set HERE_API_KEY=<your key>

npm run smoke:live
```

Notes:

- The script targets `http://localhost:3000` (override with `SMOKE_BASE_URL`).
  If no backend is running there, it starts one itself and stops it on exit.
- The script never reads or prints the API key; the backend masks it in all
  URLs, logs, and error messages.
- **Never commit `.env` or secrets.** `.env` is gitignored - keep it that way,
  and don't paste keys into code, tests, README, or commit messages.
- Unlike `npm test` (fully mocked, no network), `smoke:live` performs real
  HERE geocoding and routing calls and consumes API quota.

## Known limitations

- `weekend` and `unloadingAfter14` surcharges are accepted in the request but
  not yet applied (TODO stubs in the pricing engine).
- Transit countries (`countriesCrossed`) are inferred from toll data and may be
  incomplete on toll-free routes; origin/destination countries always come from
  geocoding and drive pricing lane selection.
- The Alps tunnel surcharge covers Fréjus and Mont Blanc only; other alpine
  tunnels (Brenner, Gotthard, …) are reported in `infrastructure.tunnels` but
  do not trigger a surcharge.
- The `EU` pricing lane group intentionally includes UK destinations (UK
  specifics are priced via `ukFerry` surcharges and `ukMin` minimums); more
  specific UK lanes take precedence.
- Unit tests do not perform live HERE calls; HERE responses are mocked at the
  HTTP layer (see `src/routes/golden-quotes.test.ts`).
- The frontend HERE Maps key (`VITE_HERE_MAPS_API_KEY`) is browser-visible by
  nature; it must be a separate, restricted key — never the backend routing
  key.
- Route geometry is computed by the backend from HERE routing; map rendering
  is client-side HERE Maps JS loading tiles directly from HERE's CDN.
- The map is read-only for now — no draggable route editing.
- Country exclusion is strict, limited to the supported European country list
  above, and applies to routing only (no map overlay of excluded borders).
  Transit micro-states (e.g. Liechtenstein) are not in the exclusion list.

## Vehicle Profiles

| ID | Weight | Dimensions (H×W×L) | Axles | Capacity |
|----|--------|-------------------|-------|----------|
| `van_8ep` | 3,500 kg | 2.7×2.2×6.5 m | 2 | 8 pallets |
| `solo_18t_23ep` | 18,000 kg | 3.6×2.55×10 m | 2 | 23 pallets |
| `ftl_13_6_33ep` | 40,000 kg | 4×2.55×16.5 m | 5 | 33 pallets |

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build TypeScript to JavaScript |
| `npm start` | Run production build |
| `npm test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
