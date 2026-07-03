#!/usr/bin/env bash
#
# Live smoke test for the four golden HERE scenarios (solo_18t_23ep):
#   1. Poznań  -> Verona                                  (solo-pl-eu)
#   2. Verona  -> Munich                                  (solo-it-eu + minimum)
#   3. Verona  -> London                                  (solo-it-uk + UK surcharge + minimum)
#   4. Turin   -> Bardonecchia -> Modane -> Chambéry      (Fréjus detection + Alps surcharge)
#
# Requirements:
#   - HERE_API_KEY must be available to the BACKEND (environment or .env).
#     This script never reads, prints, or handles the key itself - the app
#     loads it via dotenv and masks it in all URLs/errors.
#   - Backend running on http://localhost:3000 (override with SMOKE_BASE_URL).
#     If it is not running, the script starts `npx tsx src/index.ts` itself
#     and stops it on exit.
#
# Usage:
#   npm run smoke:live
#   SMOKE_BASE_URL=http://localhost:4000 bash scripts/smoke.sh
#
# Exits non-zero if any expected field does not match.

set -euo pipefail

BASE_URL="${SMOKE_BASE_URL:-http://localhost:3000}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
SERVER_PID=""
FAILURES=0

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

log()  { printf '%s\n' "$*"; }
pass() { log "  PASS  $*"; }
fail() { log "  FAIL  $*"; FAILURES=$((FAILURES + 1)); }

# ---------------------------------------------------------------------------
# Ensure the backend is up (start it if needed)
# ---------------------------------------------------------------------------
health_ok() {
  curl -sf --max-time 5 "$BASE_URL/health" >/dev/null 2>&1
}

if ! health_ok; then
  log "Backend not reachable at $BASE_URL - starting it (logs: $TMP_DIR/server.log)"
  (cd "$REPO_ROOT" && npx tsx src/index.ts >"$TMP_DIR/server.log" 2>&1) &
  SERVER_PID=$!

  for _ in $(seq 1 30); do
    health_ok && break
    sleep 1
  done

  if ! health_ok; then
    log "ERROR: backend failed to start within 30s. Last log lines:"
    tail -n 20 "$TMP_DIR/server.log" || true
    exit 1
  fi
fi
log "Backend healthy at $BASE_URL"

# ---------------------------------------------------------------------------
# Detect missing HERE_API_KEY: without it the app does not register /api/*
# ---------------------------------------------------------------------------
probe_status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  -X POST "$BASE_URL/api/quote" -H 'Content-Type: application/json' -d '{}')
if [ "$probe_status" = "404" ]; then
  log "ERROR: /api/quote is not registered."
  log "       HERE_API_KEY is not available to the backend."
  log "       Set it in the environment or in .env (never commit .env)."
  exit 1
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
quote() {
  # quote <output-file> <json-payload>
  local out="$1" payload="$2" status
  status=$(curl -s -o "$out" -w '%{http_code}' --max-time 120 \
    -X POST "$BASE_URL/api/quote" \
    -H 'Content-Type: application/json' \
    -d "$payload")
  if [ "$status" != "200" ]; then
    log "  FAIL  HTTP $status from /api/quote"
    log "        response: $(head -c 500 "$out")"
    return 1
  fi
}

# assert <response-file> <node-assertion-script>
# The node script receives the parsed response as `b` and uses
# check(condition, label, actualDescription) helpers; it exits 1 on failure.
assert() {
  local file="$1" script="$2"
  node -e "
    const fs = require('fs');
    const b = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    let failures = 0;
    const check = (cond, label, actual) => {
      if (cond) { console.log('  PASS  ' + label); }
      else { console.log('  FAIL  ' + label + ' (actual: ' + actual + ')'); failures++; }
    };
    const approx = (a, e, tol = 0.05) => Math.abs(a - e) <= tol;
    ${script}
    process.exit(failures === 0 ? 0 : 1);
  " "$file" || FAILURES=$((FAILURES + 1))
}

# ---------------------------------------------------------------------------
# Scenario 1: Poznań -> Verona (solo-pl-eu)
# ---------------------------------------------------------------------------
log ""
log "=== 1. Poznań -> Verona (solo_18t_23ep) ==="
R1="$TMP_DIR/r1.json"
if quote "$R1" '{
  "origin": { "address": "Poznań, Poland" },
  "destination": { "address": "Verona, Italy" },
  "vehicleProfileId": "solo_18t_23ep"
}'; then
  assert "$R1" "
    const q = b.quote, g = b.routeFacts.geography;
    check(q.modelId === 'solo-pl-eu', 'modelId = solo-pl-eu', q.modelId);
    check(g.originCountry === 'PL', 'originCountry = PL', g.originCountry);
    check(g.destinationCountry === 'IT', 'destinationCountry = IT', g.destinationCountry);
    const km = b.routeFacts.route.distanceKm;
    check(km > 0, 'distanceKm > 0 (' + km + ' km)', km);
    check(approx(q.finalPrice, km + 200), 'finalPrice = distanceKm + 200 (' + q.finalPrice + ' EUR)', q.finalPrice + ' vs ' + (km + 200));
  "
fi

# ---------------------------------------------------------------------------
# Scenario 2: Verona -> Munich (solo-it-eu, minimum 1200)
# ---------------------------------------------------------------------------
log ""
log "=== 2. Verona -> Munich (solo_18t_23ep) ==="
R2="$TMP_DIR/r2.json"
if quote "$R2" '{
  "origin": { "address": "Verona, Italy" },
  "destination": { "address": "Munich, Germany" },
  "vehicleProfileId": "solo_18t_23ep"
}'; then
  assert "$R2" "
    const q = b.quote, g = b.routeFacts.geography, li = q.lineItems;
    check(q.modelId === 'solo-it-eu', 'modelId = solo-it-eu', q.modelId);
    check(g.originCountry === 'IT', 'originCountry = IT', g.originCountry);
    check(g.destinationCountry === 'DE', 'destinationCountry = DE', g.destinationCountry);
    const km = b.routeFacts.route.distanceKm;
    check(approx(li.kmCharge, km * 1.2), 'kmCharge = distanceKm * 1.2', li.kmCharge + ' vs ' + km * 1.2);
    check(li.emptiesCharge === 200, 'emptiesCharge = 200', li.emptiesCharge);
    const surchargeTotal = li.surcharges.reduce((s, x) => s + x.amount, 0);
    const subtotal = li.kmCharge + li.emptiesCharge + surchargeTotal;
    if (subtotal < 1200) {
      check(q.finalPrice === 1200, 'finalPrice = 1200 (minimum applied)', q.finalPrice);
      check(approx(li.minimumAdjustment, 1200 - subtotal), 'minimumAdjustment = 1200 - subtotal', li.minimumAdjustment + ' vs ' + (1200 - subtotal));
    } else {
      check(approx(q.finalPrice, subtotal), 'finalPrice = subtotal (above minimum)', q.finalPrice + ' vs ' + subtotal);
      check(li.minimumAdjustment === null, 'minimumAdjustment = null (above minimum)', li.minimumAdjustment);
    }
  "
fi

# ---------------------------------------------------------------------------
# Scenario 3: Verona -> London (solo-it-uk, UK surcharge, minimum 2700)
# ---------------------------------------------------------------------------
log ""
log "=== 3. Verona -> London (solo_18t_23ep) ==="
R3="$TMP_DIR/r3.json"
if quote "$R3" '{
  "origin": { "address": "Verona, Italy" },
  "destination": { "address": "London, United Kingdom" },
  "vehicleProfileId": "solo_18t_23ep"
}'; then
  assert "$R3" "
    const q = b.quote, rf = b.routeFacts, li = q.lineItems;
    check(q.modelId === 'solo-it-uk', 'modelId = solo-it-uk', q.modelId);
    check(rf.geography.destinationCountry === 'GB', 'destinationCountry = GB', rf.geography.destinationCountry);
    check(rf.riskFlags.isUK === true, 'riskFlags.isUK = true', rf.riskFlags.isUK);
    check(rf.infrastructure.hasFerry === true, 'infrastructure.hasFerry = true', rf.infrastructure.hasFerry);
    const uk = li.surcharges.find((s) => s.type === 'ukFerry');
    check(uk !== undefined && uk.amount === 400, 'ukFerry surcharge = 400', JSON.stringify(uk));
    const surchargeTotal = li.surcharges.reduce((s, x) => s + x.amount, 0);
    const subtotal = li.kmCharge + li.emptiesCharge + surchargeTotal;
    if (subtotal < 2700) {
      check(q.finalPrice === 2700, 'finalPrice = 2700 (minimum applied)', q.finalPrice);
      check(approx(li.minimumAdjustment, 2700 - subtotal), 'minimumAdjustment = 2700 - subtotal', li.minimumAdjustment + ' vs ' + (2700 - subtotal));
    } else {
      check(approx(q.finalPrice, subtotal), 'finalPrice = subtotal (above minimum)', q.finalPrice + ' vs ' + subtotal);
    }
  "
fi

# ---------------------------------------------------------------------------
# Scenario 4: Turin -> Bardonecchia -> Modane -> Chambéry (Fréjus)
# ---------------------------------------------------------------------------
log ""
log "=== 4. Turin -> Bardonecchia -> Modane -> Chambéry (solo_18t_23ep) ==="
R4="$TMP_DIR/r4.json"
if quote "$R4" '{
  "origin": { "address": "Turin, Italy" },
  "via": [
    { "address": "Bardonecchia, Italy" },
    { "address": "Modane, France" }
  ],
  "destination": { "address": "Chambéry, France" },
  "vehicleProfileId": "solo_18t_23ep"
}'; then
  assert "$R4" "
    const q = b.quote, rf = b.routeFacts, li = q.lineItems, d = b.debug.hereResponse;
    check(q.modelId === 'solo-it-eu', 'modelId = solo-it-eu', q.modelId);
    check(b.debug.hereRequest.viaCount === 2, 'viaCount = 2', b.debug.hereRequest.viaCount);
    check(rf.riskFlags.crossesAlps === true, 'riskFlags.crossesAlps = true', rf.riskFlags.crossesAlps);
    check(rf.infrastructure.hasTunnel === true, 'infrastructure.hasTunnel = true', rf.infrastructure.hasTunnel);
    const names = rf.infrastructure.tunnels.map((t) => t.name);
    check(names.includes('Fréjus Tunnel'), 'tunnels include Fréjus Tunnel', JSON.stringify(names));
    const alps = li.surcharges.find((s) => s.type === 'alpsTunnel');
    check(alps !== undefined && alps.amount === 200, 'alpsTunnel surcharge = 200', JSON.stringify(alps));
    check(d.polylineFirstPoint !== null && Math.abs(d.polylineFirstPoint.lng) > 1, 'polylineFirstPoint.lng is not ~0', JSON.stringify(d.polylineFirstPoint));
    check(d.polylineBounds !== null && d.polylineBounds.minLng > 5, 'polylineBounds.minLng > 5', JSON.stringify(d.polylineBounds));
    check(d.polylineSwapApplied === false, 'polylineSwapApplied = false', d.polylineSwapApplied);
    check(d.firstPointLngPatched === false, 'firstPointLngPatched = false', d.firstPointLngPatched);
    check(['polylineBbox', 'waypointProximity'].includes(d.alpsMatchReason.frejus), 'alpsMatchReason.frejus = polylineBbox|waypointProximity', d.alpsMatchReason.frejus);
  "
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
log ""
if [ "$FAILURES" -eq 0 ]; then
  log "SMOKE OK: all four golden scenarios passed against $BASE_URL"
  exit 0
else
  log "SMOKE FAILED: $FAILURES scenario(s) had failing assertions (see FAIL lines above)"
  exit 1
fi
