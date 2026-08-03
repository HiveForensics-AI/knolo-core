#!/usr/bin/env bash
# Fail if the CLI-bundled ICP canister sources drift from packages/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_CANISTER="$ROOT/packages/icp-canister/src/lib.rs"
TPL_CANISTER="$ROOT/packages/cli/templates/icp-knowledge-canister/canisters/knolo-icp-canister/src/lib.rs"
PKG_DID="$ROOT/packages/icp-canister/knolo_icp.did"
TPL_DID="$ROOT/packages/cli/templates/icp-knowledge-canister/canisters/knolo-icp-canister/knolo_icp.did"
PKG_CORE="$ROOT/packages/core-rust/src/lib.rs"
TPL_CORE="$ROOT/packages/cli/templates/icp-knowledge-canister/canisters/knolo-core-rust/src/lib.rs"

fail=0

check_pair() {
  local left="$1"
  local right="$2"
  if ! diff -u "$left" "$right" >/dev/null; then
    echo "Drift detected:" >&2
    echo "  $left" >&2
    echo "  $right" >&2
    diff -u "$left" "$right" | head -n 80 >&2 || true
    fail=1
  fi
}

check_pair "$PKG_CANISTER" "$TPL_CANISTER"
check_pair "$PKG_DID" "$TPL_DID"
check_pair "$PKG_CORE" "$TPL_CORE"

if [ "$fail" -ne 0 ]; then
  echo "ICP template is out of sync with packages/. Copy package sources into the CLI template." >&2
  exit 1
fi

echo "ICP template sources match packages/icp-canister and packages/core-rust."
