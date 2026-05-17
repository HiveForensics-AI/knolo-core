#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DFX_BIN="${DFX_BIN:-dfx}"
CANISTER_NAME="${CANISTER_NAME:-knolo_knowledge}"
PACK_LABEL="${PACK_LABEL:-sample-knowledge-pack}"
PACK_PATH="${PACK_PATH:-$ROOT/dist/knowledge.knolo}"
ARGS_FILE="$(mktemp "${TMPDIR:-/tmp}/knolo-set-pack-XXXXXX.did")"

if [ "${TERM:-}" = 'dumb' ]; then
  export TERM=xterm-256color
fi

cleanup() {
  rm -f "$ARGS_FILE"
}

trap cleanup EXIT

if [ ! -f "$PACK_PATH" ]; then
  echo "Pack file not found at $PACK_PATH. Run node scripts/build-sample-pack.mjs first." >&2
  exit 1
fi

node --input-type=module - "$PACK_PATH" "$PACK_LABEL" "$ARGS_FILE" <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs';

const [packPath, label, outPath] = process.argv.slice(2);
const bytes = readFileSync(packPath);
const renderedBytes = bytes.length
  ? ` ${Array.from(bytes, (value) => `${value}`).join('; ')} `
  : '';

writeFileSync(outPath, `(vec {${renderedBytes}}, ${JSON.stringify(label)})\n`);
EOF

cd "$ROOT"
"$DFX_BIN" canister call "$CANISTER_NAME" set_pack --argument-file "$ARGS_FILE" --output json
"$DFX_BIN" canister call "$CANISTER_NAME" pack_info --query --output json
