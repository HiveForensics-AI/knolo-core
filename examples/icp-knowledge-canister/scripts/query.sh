#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DFX_BIN="${DFX_BIN:-dfx}"
CANISTER_NAME="${CANISTER_NAME:-knolo_knowledge}"
QUERY_TEXT="${1:-alpha beta}"
TOP_K="${TOP_K:-5}"
ARGS_FILE="$(mktemp "${TMPDIR:-/tmp}/knolo-query-XXXXXX.did")"

if [ "${TERM:-}" = 'dumb' ]; then
  export TERM=xterm-256color
fi

cleanup() {
  rm -f "$ARGS_FILE"
}

trap cleanup EXIT

node --input-type=module - "$QUERY_TEXT" "$TOP_K" "$ARGS_FILE" <<'EOF'
import { writeFileSync } from 'node:fs';

const [queryText, topK, outPath] = process.argv.slice(2);
const renderedTopK = Number.parseInt(topK, 10);

if (!Number.isInteger(renderedTopK) || renderedTopK <= 0) {
  console.error(`TOP_K must be a positive integer. Received: ${topK}`);
  process.exit(1);
}

writeFileSync(outPath, `(${JSON.stringify(queryText)}, ${renderedTopK} : nat32)\n`);
EOF

cd "$ROOT"
"$DFX_BIN" canister call "$CANISTER_NAME" search --query --argument-file "$ARGS_FILE" --output json
