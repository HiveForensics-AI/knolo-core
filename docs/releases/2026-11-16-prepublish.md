# Pre-publish check, 2026-11-16

This record is the local check of main `9d58d66bb04154214dfedb7d60e86a3e7dfb4df4`
on Node v22.14.0. It is not an npm publish. Package versions were not changed.
No tag was created and no GitHub Release was opened.

npm `latest` at the time of this check:

| Package | npm latest |
| --- | --- |
| `@knolo/core` | 6.2.3 |
| `@knolo/cli` | 6.2.7 |
| `@knolo/exchange` | 0.1.0 |
| `@knolo/tools` | 0.2.1 |
| `@knolo/mcp` | 0.2.3 |
| `@knolo/ai-sdk` | 0.1.0 |
| `@knolo/mastra` | 0.1.0 |
| `@knolo/openai-agents` | 0.1.0 |
| `n8n-nodes-knolo` | 0.1.0 |

`@knolo/cli@6.2.7` includes `knolo kite` and private Hub publish. It does not
include `knolo research verify` or `knolo exchange relay`. `@knolo/exchange@0.1.0`
does not include the relay. `@knolo/tools@0.2.1` and `@knolo/mcp@0.2.3` do not
include the KITE evaluate and verify tools. `n8n-nodes-knolo@0.1.0` is search,
get, and verify.

| Command | Result |
| --- | --- |
| `npm test --workspace @knolo/exchange` | 17 passed |
| `npm test --workspace @knolo/cli` | 113 passed, 1 skipped, 0 failed |
| `npm test --workspace @knolo/tools` | No `test` script. `tsc` succeeded inside the host builds and `release:check`. |
| `npm test --workspace @knolo/mcp` | 28 passed |
| `npm test --workspace @knolo/ai-sdk` | 7 passed |
| `npm test --workspace @knolo/mastra` | 7 passed |
| `npm test --workspace @knolo/openai-agents` | 4 passed |
| `npm test --workspace n8n-nodes-knolo` | 15 passed |
| `npm run release:check` | Passed. V5 preflight, release metadata, 303 Markdown files, package source checks, and archive checks. |

The skipped CLI test is `optional live Hub read path smoke`. `@knolo/tools`
is covered by the MCP, AI SDK, Mastra, OpenAI Agents, and n8n suites, which
build it before their tests.

Rust, Python, and the ICP canister stay 5.5.1. This page does not bump a
version. A later stamp sets the package files for the unpublished relay,
research verify, KITE host tools, and n8n Status, KAR, and Cortex operations.
