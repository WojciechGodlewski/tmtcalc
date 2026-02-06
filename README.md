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
      "originCountry": "DEU",
      "destinationCountry": "POL",
      "countriesCrossed": ["DEU", "POL"],
      "isInternational": true,
      "isEU": null
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
