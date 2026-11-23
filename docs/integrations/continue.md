# Continue

Continue can launch the published Knolo MCP server over stdio. The draft block is [`packages/mcp/listings/continue/knolo.yaml`](../../packages/mcp/listings/continue/knolo.yaml). Knolo does not call a model and does not read an API key. The host owns the model.

Put the block in `.continue/mcpServers/knolo.yaml` at the workspace root, or add the same `mcpServers` entry to `~/.continue/config.yaml`. MCP tools load only in Continue agent mode.

```yaml
name: Knolo
version: 0.0.1
schema: v1
mcpServers:
  - name: Knolo
    type: stdio
    command: npx
    args:
      - '-y'
      - '@knolo/mcp@0.2.4'
      - '--config'
      - /absolute/knolo-mcp.json
```

Replace `/absolute/knolo-mcp.json` with the absolute path of a Knolo MCP config that points at a pinned local Knowledge Image. A missing or invalid config fails closed. `npx` and Node must be on the PATH Continue uses. `@knolo/mcp@0.2.4` is the npm release. The server does not listen on a port.

That command is the same one the other host docs run:

```bash
npx -y @knolo/mcp@0.2.4 --config /absolute/knolo-mcp.json
```

A mount without a `kar` block exposes `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`. A mount with a `kar` block also exposes `knolo_kar_evaluate`, `knolo_kar_verify`, and `knolo_cortex_verify`. Pins, policy, and the audit directory stay in the config file. Tool arguments cannot set the caller, the image, or the policy.

`knolo_search` writes an `openclaw-knolo-query-v1` receipt before it returns hits. Each hit carries an object id and the image state root. Each kept term is a whole word. Unquoted stopwords and terms shorter than 3 characters are dropped.

A receipt is an integrity check. It does not mean a claim is proven. Verification checks the image bytes, the state root, and the policy root.

`SATISFIED` from `knolo_kar_evaluate` means the evidence requirements in the plan were met. It does not mean a claim is proven.

The server does not download images, write knowledge, or call a model. An unwritable audit directory returns `AUDIT_UNAVAILABLE` and no hits.

The 400×400 listing logo is [logo.png](https://raw.githubusercontent.com/HiveForensics-AI/knolo-core/main/packages/mcp/listings/cline/logo.png).

Continuous integration checks that the draft is a stdio `npx` command for `@knolo/mcp@0.2.4` and that the file has no URL. It does not install the Continue app. The same fixture search the other host jobs run is what this command returns once Continue starts it.

Publishing the block to Continue Hub is a separate account step. The local YAML works before that publish.

Server configuration is documented in the [`@knolo/mcp` README](../../packages/mcp/README.md).
