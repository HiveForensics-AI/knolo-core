# icp-knowledge-canister

Minimal local `dfx` example for deploying a Knolo ICP canister without any middleware server.

This scaffold:

- builds a real `.knolo` pack from local sample docs
- vendors the Rust canister sources locally under `canisters/`
- uploads the pack with `knolo icp upload`
- queries the canister directly
- includes a tiny Vite + React browser client that talks to the canister directly

## Prerequisites

Local ICP development needs `dfx`, Rust, the WASM target, and the Knolo CLI:

```bash
npm install -g @knolo/cli
rustup target add wasm32-unknown-unknown
```

## Run The Example

```bash
cd icp-knowledge-canister
dfx start --background
dfx deploy
knolo icp build-pack ./knowledge --out ./dist/knowledge.knolo
knolo icp upload ./dist/knowledge.knolo --canister knolo_knowledge
knolo icp query "alpha beta" --canister knolo_knowledge
```

If `dfx` is running under a minimal shell and complains about terminal colors, rerun the `dfx` commands with:

```bash
TERM=xterm-256color dfx start --background
TERM=xterm-256color dfx deploy
```

To run the browser client:

```bash
cd frontend
npm install
npm run dev
```

The frontend uses `VITE_KNOLO_CANISTER_ID` when provided. Otherwise it falls back to the local canister ID from `.dfx/local/canister_ids.json`, which is available after `dfx deploy`.

## What Gets Built

- `dfx deploy` compiles the local canister from `./canisters/knolo-icp-canister`
- `knolo icp build-pack ./knowledge --out ./dist/knowledge.knolo` writes `dist/knowledge.knolo`
- `knolo icp upload ./dist/knowledge.knolo --canister knolo_knowledge` calls `set_pack(bytes, label)`
- `knolo icp query "alpha beta" --canister knolo_knowledge` calls `search("alpha beta", 5)`

Helper wrappers remain available under `scripts/` if you prefer shorter commands:

```bash
node scripts/build-sample-pack.mjs
bash scripts/upload-pack.sh
bash scripts/query.sh "alpha beta"
```

## Sample Content

The pack is built from the checked-in files under `knowledge/`, so the example stays deterministic and easy to rerun locally.
