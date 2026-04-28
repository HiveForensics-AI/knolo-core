#!/usr/bin/env bash
set -euo pipefail

echo "[phase-1] Checking Rust core tests"
cargo test --manifest-path packages/core-rust/Cargo.toml

echo "[phase-1] Checking ICP canister tests"
cargo test --manifest-path packages/icp-canister/Cargo.toml

echo "[phase-1] Checking Candid file exists"
test -f packages/icp-canister/knolo_icp.did

grep -q "search" packages/icp-canister/knolo_icp.did
grep -q "set_pack" packages/icp-canister/knolo_icp.did
grep -q "pack_info" packages/icp-canister/knolo_icp.did

echo "[phase-1] OK"
