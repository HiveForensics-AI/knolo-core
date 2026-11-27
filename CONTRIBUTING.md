# Contributing to Knolo

Thanks for helping improve Knolo. This guide covers what to install, how the
repository fits together, and which checks to run before you open a pull
request.

## Prerequisites

- **Node.js 20 or newer** and npm. Most packages need `>=20`. A few need
  newer versions: `@knolo/ai-sdk` needs `>=22` and `@knolo/mastra` needs
  `>=22.13.0`. Using Node 22 covers every workspace.
- **Rust (stable)**, only if you change `packages/core-rust`,
  `packages/icp-canister` or `packages/zed-extension`. CI uses the stable
  toolchain.
- **Python 3.12**, only if you change `packages/core-python`.

## Getting started

```bash
git clone https://github.com/<your-username>/knolo-core.git
cd knolo-core
npm install
npm run build
```

The root `package.json` uses npm workspaces (`packages/*`), so one
`npm install` at the root sets up every TypeScript package.

## Where things live

| Path                   | What it contains                                              |
| ---------------------- | ------------------------------------------------------------- |
| `packages/core`        | `@knolo/core`: pack, mount and verify Knowledge Images        |
| `packages/cli`         | `@knolo/cli`: inspect, verify, Hub search, install, publish   |
| `packages/mcp`         | `@knolo/mcp`: read-only MCP tools on a pinned Knowledge Image |
| `packages/knolo-tools` | `@knolo/tools`: host-agnostic query, policy and receipts      |
| `packages/reflex`      | `@knolo/reflex`: behavior packs (versioned separately)        |
| `packages/core-rust`   | Native Rust V5 kernel and verifier                            |
| `packages/core-python` | Python V5 verifier and query package                          |
| `packages/*`           | Framework integrations (AI SDK, Mastra, LangChain, and more)  |
| `spec/`                | KIP contracts, including KAR-1                                |
| `conformance/`         | Cross-runtime fixtures and acceptance tests                   |
| `docs/`                | Guides for KAR, Cortex, composition, integrations and Hub     |
| `examples/`            | Framework and product integration examples                    |

See the [documentation index](docs/README.md) for the full list of guides.

## Before you open a pull request

Run the tests for the package you changed, then the release check from the
repository root:

```bash
npm run test --workspace <package-name>   # for example @knolo/mcp
npm run release:check
```

`release:check` builds every workspace, checks V5 release rules and release
metadata, validates documentation links (`npm run docs:check`) and checks
package publication and archives.

If you changed Rust code:

```bash
npm run test:rust
```

If you only changed documentation, `npm run docs:check` is the quickest check
that every relative link still resolves.

## Rules for format changes

Changes to byte formats, digest domains, identity rules or required sections
must include updated specification text in `spec/` and updated cross-runtime
fixtures in `conformance/`. TypeScript and Rust must keep passing the same
golden vectors.

## Hub tokens

If you test Hub commands locally:

- Use a dashboard `kno_…` token with `knolo login --token kno_…`.
- Do not set `PACKS_READ_WRITE_TOKEN` in the CLI. That is Hub's store secret.
- A `401` usually means the `Bearer` word is missing from the
  `Authorization` header or the token was revoked.
- Use `KNOLO_HUB_URL` or `--registry` to point the CLI at a local Hub.

## Pull request tips

- Keep each pull request focused on one change.
- Say what changed, why it helps and how you tested it.
- Never commit tokens, keys or `.env` files.

## Questions

If something in this guide is unclear or out of date, open an issue.
