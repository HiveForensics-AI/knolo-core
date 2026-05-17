# icp-knowledge-canister

Minimal local `dfx` example for deploying the Knolo ICP canister without any middleware server.

The example:

- builds a real `.knolo` pack from local sample docs
- deploys the Rust canister from `packages/icp-canister`
- uploads the pack with `dfx canister call`
- queries the canister directly
- includes a tiny Vite + React browser client that talks to the canister directly

## Prerequisites

From the repo root:

```bash
npm install
```

Local ICP development also needs `dfx` plus the Rust wasm target:

```bash
rustup target add wasm32-unknown-unknown
```

## Run The Example

```bash
cd examples/icp-knowledge-canister
dfx start --background
dfx deploy
node scripts/build-sample-pack.mjs
bash scripts/upload-pack.sh
bash scripts/query.sh "alpha beta"
```

If `dfx` is running under a minimal shell and complains about terminal colors, rerun the `dfx` commands with:

```bash
TERM=xterm-256color dfx start --background
TERM=xterm-256color dfx deploy
```

To run the browser client:

```bash
cd examples/icp-knowledge-canister/frontend
npm install
npm run dev
```

The frontend uses `VITE_KNOLO_CANISTER_ID` when provided. Otherwise it falls back to the local canister ID from `.dfx/local/canister_ids.json`, which is available after `dfx deploy`.

## What Gets Built

- `dfx deploy` compiles the canister from `../../packages/icp-canister`
- `node scripts/build-sample-pack.mjs` writes `dist/knowledge.knolo`
- `bash scripts/upload-pack.sh` calls `set_pack(bytes, label)`
- `bash scripts/query.sh "alpha beta"` calls `search("alpha beta", 5)`

## Sample Content

The pack is built from the checked-in files under `knowledge/`, so the example stays deterministic and easy to rerun locally.
