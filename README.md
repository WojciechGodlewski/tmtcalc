# TMT Calc

Backend-only MVP for transport pricing calculator.

## Setup

```bash
# Install dependencies
npm install

# Copy environment template and add your HERE API key
cp .env.example .env
# Edit .env and set HERE_API_KEY=your_key_here

# Start development server
npm run dev

# Run tests
npm test

# Build for production
npm run build
npm start
```

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
