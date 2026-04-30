#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXAMPLE_DIR="$ROOT/examples/icp-knowledge-canister"
CORE_MANIFEST="$ROOT/packages/core-rust/Cargo.toml"
CANISTER_MANIFEST="$ROOT/packages/icp-canister/Cargo.toml"
PACK_PATH="$EXAMPLE_DIR/dist/knowledge.knolo"
DFX_BIN="${DFX_BIN:-dfx}"
DFX_DATA_HOME="${DFX_DATA_HOME:-}"
DFX_STARTED=0
DFX_DATA_HOME_CREATED=0
DFX_TERM="${DFX_TERM:-xterm-256color}"

log() {
  echo "[e2e] $*"
}

cleanup() {
  if [ "$DFX_STARTED" -eq 1 ]; then
    log "Stop dfx"
    (
      cd "$EXAMPLE_DIR"
      TERM="$DFX_TERM" XDG_DATA_HOME="$DFX_DATA_HOME" "$DFX_RUN_BIN" stop >/dev/null 2>&1 || true
    )
  fi

  if [ "$DFX_DATA_HOME_CREATED" -eq 1 ] && [ -n "$DFX_DATA_HOME" ]; then
    rm -rf "$DFX_DATA_HOME"
  fi
}

trap cleanup EXIT

if ! command -v "$DFX_BIN" >/dev/null 2>&1; then
  echo "[e2e] Missing dfx binary: $DFX_BIN" >&2
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "[e2e] Missing cargo" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[e2e] Missing node" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[e2e] Missing npm" >&2
  exit 1
fi

if [ ! -d "$EXAMPLE_DIR" ]; then
  echo "[e2e] Example directory not found: $EXAMPLE_DIR" >&2
  exit 1
fi

if [ -z "$DFX_DATA_HOME" ]; then
  DFX_DATA_HOME="$(mktemp -d "${TMPDIR:-/tmp}/knolo-dfx-data-XXXXXX")"
  DFX_DATA_HOME_CREATED=1
fi

DFX_VERSION="$("$DFX_BIN" --version | awk '{print $2}')"
DFX_VERSIONED_BIN="$HOME/.local/share/dfx/versions/$DFX_VERSION/dfx"
DFX_RUN_BIN="$DFX_BIN"

if [ -x "$DFX_VERSIONED_BIN" ]; then
  DFX_RUN_BIN="$DFX_VERSIONED_BIN"
fi

mkdir -p "$DFX_DATA_HOME"

run_dfx() {
  TERM="$DFX_TERM" XDG_DATA_HOME="$DFX_DATA_HOME" "$DFX_RUN_BIN" "$@"
}

log "Build Rust core"
cargo build --manifest-path "$CORE_MANIFEST"

log "Test Rust core"
cargo test --manifest-path "$CORE_MANIFEST"

log "Build ICP canister"
cargo build --target wasm32-unknown-unknown --release --manifest-path "$CANISTER_MANIFEST"

log "Test ICP canister"
cargo test --manifest-path "$CANISTER_MANIFEST"

log "Start dfx"
(
  cd "$EXAMPLE_DIR"
  run_dfx start --background --clean
)
DFX_STARTED=1

log "Deploy canister"
(
  cd "$EXAMPLE_DIR"
  run_dfx deploy
)

log "Build sample pack"
(
  cd "$EXAMPLE_DIR"
  node scripts/build-sample-pack.mjs
)

if [ ! -f "$PACK_PATH" ]; then
  echo "[e2e] Expected pack output at $PACK_PATH" >&2
  exit 1
fi

log "Upload pack"
(
  cd "$EXAMPLE_DIR"
  DFX_BIN="$DFX_RUN_BIN" TERM="$DFX_TERM" XDG_DATA_HOME="$DFX_DATA_HOME" bash scripts/upload-pack.sh
)

log "Query canister"
OUT="$(
  cd "$EXAMPLE_DIR"
  DFX_BIN="$DFX_RUN_BIN" TERM="$DFX_TERM" XDG_DATA_HOME="$DFX_DATA_HOME" bash scripts/query.sh "alpha beta"
)"
printf '%s\n' "$OUT"

if [ -z "$OUT" ]; then
  echo "[e2e] Search result was empty" >&2
  exit 1
fi

echo "$OUT" | grep -q '"text"'
echo "$OUT" | grep -qi "alpha"
echo "$OUT" | grep -qi "beta"

log "OK"
