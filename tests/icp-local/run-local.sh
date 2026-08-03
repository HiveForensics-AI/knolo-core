#!/usr/bin/env bash
# Deploy the Knolo ICP canister locally, seed dummy data, and expose CLI + REST endpoints.
# Leaves the replica (and optional REST gateway) running for manual Postman/CLI testing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HARNESS_DIR="$ROOT/tests/icp-local"
EXAMPLE_DIR="$ROOT/examples/icp-knowledge-canister"
DATA_DIR="$HARNESS_DIR/data"
PACK_PATH="$DATA_DIR/seed.knolo"
CLI="$ROOT/packages/cli/bin/knolo.mjs"
DFX_BIN="${DFX_BIN:-dfx}"
DFX_TERM="${DFX_TERM:-xterm-256color}"
CANISTER_NAME="${CANISTER_NAME:-knolo_knowledge}"
PACK_LABEL="${PACK_LABEL:-local-dummy-seed}"
REST_PORT="${KNOLO_REST_PORT:-8787}"
START_GATEWAY="${START_GATEWAY:-1}"
CLEAN_START="${CLEAN_START:-1}"
DFX_STARTED=0
GATEWAY_PID=""

log() { echo "[icp-local] $*"; }

cleanup_gateway() {
  if [ -n "$GATEWAY_PID" ] && kill -0 "$GATEWAY_PID" 2>/dev/null; then
    kill "$GATEWAY_PID" 2>/dev/null || true
    wait "$GATEWAY_PID" 2>/dev/null || true
  fi
}

on_exit() {
  cleanup_gateway
  if [ "${KEEP_REPLICA:-1}" = "0" ] && [ "$DFX_STARTED" -eq 1 ]; then
    log "Stopping dfx (KEEP_REPLICA=0)"
    (
      cd "$EXAMPLE_DIR"
      TERM="$DFX_TERM" "$DFX_BIN" stop >/dev/null 2>&1 || true
    )
  else
    log "Replica left running for manual testing (set KEEP_REPLICA=0 to stop on exit)"
  fi
}

trap on_exit EXIT

if ! command -v "$DFX_BIN" >/dev/null 2>&1; then
  echo "Missing dfx. Install dfx 0.20+ first." >&2
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "Missing cargo." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Missing node." >&2
  exit 1
fi

run_dfx() {
  TERM="$DFX_TERM" "$DFX_BIN" "$@"
}

log "Generate dummy seed data (gitignored under tests/icp-local/data)"
node "$HARNESS_DIR/generate-seed.mjs"

if [ ! -f "$PACK_PATH" ]; then
  echo "Seed pack missing at $PACK_PATH" >&2
  exit 1
fi

log "Build canister wasm"
cargo build --target wasm32-unknown-unknown --release --manifest-path "$ROOT/packages/icp-canister/Cargo.toml"

log "Ensure local dfx replica"
cd "$EXAMPLE_DIR"
if ! run_dfx ping >/dev/null 2>&1; then
  if [ "$CLEAN_START" = "1" ]; then
    run_dfx start --background --clean
  else
    run_dfx start --background
  fi
  DFX_STARTED=1
else
  log "dfx already running"
  DFX_STARTED=0
fi
cd "$ROOT"

log "Deploy knolo_knowledge"
cd "$EXAMPLE_DIR"
run_dfx deploy
CANISTER_ID="$(run_dfx canister id "$CANISTER_NAME")"
CANDID_UI="$(run_dfx canister id __Candid_UI 2>/dev/null || true)"

# knolo icp / dfx name resolution requires the dfx project cwd
log "Upload seed pack (controller identity)"
node "$CLI" icp upload "$PACK_PATH" --canister "$CANISTER_NAME" --label "$PACK_LABEL"

log "Verify health + info + sample query via CLI"
node "$CLI" icp health --canister "$CANISTER_NAME"
node "$CLI" icp info --canister "$CANISTER_NAME"
node "$CLI" icp query "billing escalation" --canister "$CANISTER_NAME" --k 3

if [ "$START_GATEWAY" = "1" ]; then
  log "Start REST gateway on http://127.0.0.1:${REST_PORT}"
  mkdir -p "$HARNESS_DIR/.runtime"
  KNOLO_CANISTER="$CANISTER_NAME" \
  KNOLO_DFX_CWD="$EXAMPLE_DIR" \
  KNOLO_REST_PORT="$REST_PORT" \
  DFX_BIN="$DFX_BIN" \
  node "$HARNESS_DIR/rest-gateway.mjs" >"$HARNESS_DIR/.runtime/gateway.log" 2>&1 &
  GATEWAY_PID=$!
  echo "$GATEWAY_PID" >"$HARNESS_DIR/.runtime/gateway.pid"
  sleep 0.5
fi

cat <<EOF

============================================================
Knolo ICP local environment is ready
============================================================
Canister name : $CANISTER_NAME
Canister id   : $CANISTER_ID
Seed pack     : $PACK_PATH  (gitignored)
Replica       : http://127.0.0.1:4943
dfx project   : $EXAMPLE_DIR

CLI examples (run from the dfx project dir, or pass the canister id):
  cd $EXAMPLE_DIR
  node $CLI icp health --canister $CANISTER_NAME
  node $CLI icp info --canister $CANISTER_NAME
  node $CLI icp query "password reset" --canister $CANISTER_NAME --k 5

  # from any directory using the principal id:
  node $CLI icp query "billing" --canister $CANISTER_ID --k 5

dfx / terminal:
  cd $EXAMPLE_DIR
  dfx canister call $CANISTER_NAME health --query --output json
  dfx canister call $CANISTER_NAME pack_info --query --output json
  dfx canister call $CANISTER_NAME search --query --output json --argument '("billing", 5 : nat32)'

Postman / curl (REST gateway):
  GET  http://127.0.0.1:${REST_PORT}/health
  GET  http://127.0.0.1:${REST_PORT}/info
  GET  http://127.0.0.1:${REST_PORT}/search?q=billing%20escalation&k=5
  POST http://127.0.0.1:${REST_PORT}/search
       Body (JSON): { "q": "password reset", "k": 5 }

Candid UI (if available):
  http://127.0.0.1:4943/?canisterId=${CANDID_UI:-<candid-ui-id>}&id=$CANISTER_ID

Press Ctrl+C to stop the REST gateway.
Replica stays up unless KEEP_REPLICA=0.
============================================================
EOF

if [ "$START_GATEWAY" = "1" ] && [ -n "$GATEWAY_PID" ]; then
  wait "$GATEWAY_PID"
else
  log "START_GATEWAY=0 — no REST gateway; replica remains for CLI/dfx testing"
  if [ -t 0 ]; then
    log "Press Ctrl+C when finished testing"
    while true; do sleep 3600; done
  fi
fi
