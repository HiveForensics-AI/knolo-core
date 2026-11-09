# ai-sdk

`@knolo/ai-sdk` returns AI SDK tools for one pinned Knowledge Image. The host
owns the model. This smoke does not call one, and it does not read an API
key.

`@knolo/ai-sdk@0.1.0` is published. It needs Node.js 22 or newer and does not
run on the edge runtime.

Search keeps each remaining term as a whole word. Unquoted stopwords and terms shorter than 3 characters are dropped. A receipt is an
integrity check. It does not mean a claim is proven. `SATISFIED` means
evidence requirements were met.

A host that already speaks MCP can use the published server instead:

```bash
npx -y @knolo/mcp@0.2.1 --config /absolute/knolo-mcp.json
```

## Run the smoke

From the repository root:

```bash
npm run build --workspace @knolo/core
npm run build --workspace @knolo/tools
npm run build --workspace @knolo/ai-sdk
config="$(node examples/google_adk_python/prepare-fixture.mjs)"
export KNOLO_MCP_CONFIG="$config"
node examples/ai-sdk/smoke.mjs
```

`prepare-fixture.mjs` writes a two-chunk image, a deny-default policy, and
`knolo-mcp.json` under a temporary directory. The fixture has no pinned
graph, so the tools are `knolo_search`, `knolo_get`, `knolo_verify`, and
`knolo_status`. The smoke searches for `enterprise refunds` and expects the
refunds excerpt and a `qr_` receipt id. It prints `modelCalled: false`.

The integration page is
[docs/integrations/ai-sdk.md](../../docs/integrations/ai-sdk.md). Package
details are in the
[`@knolo/ai-sdk` README](../../packages/ai-sdk/README.md).
