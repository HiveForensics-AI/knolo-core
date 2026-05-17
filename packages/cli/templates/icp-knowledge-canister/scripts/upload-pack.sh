#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KNOLO_BIN="${KNOLO_BIN:-knolo}"
CANISTER_NAME="${CANISTER_NAME:-knolo_knowledge}"
PACK_LABEL="${PACK_LABEL:-sample-knowledge-pack}"
PACK_PATH="${PACK_PATH:-$ROOT/dist/knowledge.knolo}"

if [ ! -f "$PACK_PATH" ]; then
  echo "Pack file not found at $PACK_PATH. Run node scripts/build-sample-pack.mjs first." >&2
  exit 1
fi

cd "$ROOT"
"$KNOLO_BIN" icp upload "$PACK_PATH" --canister "$CANISTER_NAME" --label "$PACK_LABEL"
