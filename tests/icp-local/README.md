# ICP local manual harness

This harness intentionally exercises the legacy ICP v3 capability profile.
The main TypeScript build emits v4 packs; use the ICP CLI builder, which opts
into v3 for the current canister reader.

It does not exercise the V5 Knowledge Image runtime yet. V5 release checks and
read-only Studio management run locally through the root CLI; see the
[roadmap](../../docs/ROADMAP.md) for the planned ICP integration.

Deploy the Knolo knowledge canister on a **local dfx replica**, seed it with **generated dummy data**, and exercise it from:

- `knolo icp` CLI / `dfx canister call`
- REST gateway (Postman / curl) on `http://127.0.0.1:8787`

## What is committed vs local-only

| Path | Git |
|------|-----|
| `generate-seed.mjs`, `rest-gateway.mjs`, `run-local.sh`, `README.md`, `.gitignore` | committed |
| `data/` (dummy markdown + `seed.knolo` + manifest) | **gitignored** |
| `.runtime/` (gateway pid/metadata) | **gitignored** |

Seed content is created on each run and never needs to be committed.

## Prerequisites

From the repo root:

```bash
npm install
npm run build --workspace @knolo/core
rustup target add wasm32-unknown-unknown
# dfx 0.20.x on PATH
```

## One-command local deploy + seed

```bash
bash tests/icp-local/run-local.sh
```

This will:

1. Generate dummy docs + pack under `tests/icp-local/data/` (gitignored)
2. Build the canister wasm
3. Start/use local dfx and `dfx deploy` `knolo_knowledge`
4. Upload the seed pack as controller
5. Smoke-test via CLI
6. Start the REST gateway on port **8787**
7. Leave the replica running for your own tests

Stop the gateway with **Ctrl+C**. The replica stays up unless you set `KEEP_REPLICA=0`.

### Useful env vars

| Variable | Default | Meaning |
|----------|---------|---------|
| `KNOLO_REST_PORT` | `8787` | REST gateway port |
| `START_GATEWAY` | `1` | Set `0` to skip REST gateway |
| `KEEP_REPLICA` | `1` | Set `0` to stop dfx on script exit |
| `CLEAN_START` | `1` | `dfx start --clean` when starting fresh |
| `CANISTER_NAME` | `knolo_knowledge` | Canister name |
| `DFX_BIN` | `dfx` | dfx binary override |

## Postman

Import/create requests against:

| Method | URL | Body |
|--------|-----|------|
| GET | `http://127.0.0.1:8787/health` | — |
| GET | `http://127.0.0.1:8787/info` | — |
| GET | `http://127.0.0.1:8787/search?q=billing&k=5` | — |
| POST | `http://127.0.0.1:8787/search` | `{ "q": "password reset", "k": 5 }` |

## CLI

```bash
cd examples/icp-knowledge-canister
node ../../packages/cli/bin/knolo.mjs icp health --canister knolo_knowledge
node ../../packages/cli/bin/knolo.mjs icp info --canister knolo_knowledge
node ../../packages/cli/bin/knolo.mjs icp query "deploy checklist" --canister knolo_knowledge --k 5
```

## Security notes

- `set_pack` / `clear_pack` require a **canister controller** (your local dfx identity after deploy).
- Pack uploads larger than **2 MiB** are rejected by the canister.
- This harness is for **local testing only**.
