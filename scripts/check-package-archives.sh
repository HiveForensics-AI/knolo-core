#!/usr/bin/env bash
set -euo pipefail

npm_cache_dir="${TMPDIR:-/tmp}/knolo-v5-npm-publication-check-cache"
mkdir -p "$npm_cache_dir"

for package_name in \
  '@knolo/core' \
  '@knolo/cli' \
  '@knolo/langchain' \
  '@knolo/llamaindex' \
  '@knolo/semantic-ollama' \
  'create-knolo-app'; do
  npm --cache "$npm_cache_dir" pack --workspace "$package_name" --dry-run --json >/dev/null
  echo "npm archive check passed: $package_name"
done

cargo package --manifest-path packages/core-rust/Cargo.toml --allow-dirty --no-verify --list >/dev/null
echo 'Rust archive check passed: packages/core-rust/Cargo.toml'
cargo package --manifest-path packages/icp-canister/Cargo.toml --allow-dirty --no-verify --list >/dev/null
echo 'Rust archive check passed: packages/icp-canister/Cargo.toml'

echo 'Package archive checks passed.'
