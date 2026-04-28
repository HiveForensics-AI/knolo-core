#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KNOLO_BIN="${KNOLO_BIN:-knolo}"
CANISTER_NAME="${CANISTER_NAME:-knolo_knowledge}"
QUERY_TEXT="${1:-alpha beta}"
TOP_K="${TOP_K:-5}"

cd "$ROOT"
"$KNOLO_BIN" icp query "$QUERY_TEXT" --canister "$CANISTER_NAME" --k "$TOP_K"
