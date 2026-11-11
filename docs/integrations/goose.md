# Goose

Goose can launch the published Knolo MCP server as a stdio extension. The draft block is [`packages/mcp/listings/goose/extension.yaml`](../../packages/mcp/listings/goose/extension.yaml). Knolo does not call a model and does not read an API key. A Goose window run belongs to the host.

Add an entry under `extensions` in `~/.config/goose/config.yaml`. The server stays stdio. Goose does not receive a URL, and this server does not listen on a port.

```yaml
extensions:
  knolo:
    type: stdio
    name: knolo
    enabled: true
    cmd: npx
    args:
      - -y
      - "@knolo/mcp@0.2.3"
      - --config
      - /absolute/knolo-mcp.json
    timeout: 300
```

Replace `/absolute/knolo-mcp.json` with the absolute path of a Knolo MCP config. `npx` and Node must be on the PATH Goose uses. `@knolo/mcp@0.2.3` is the npm release.

That command is the same one the other host docs run:

```bash
npx -y @knolo/mcp@0.2.3 --config /absolute/knolo-mcp.json
```

A mount without a `kar` block exposes `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`. A mount with a `kar` block also exposes `knolo_kar_evaluate`, `knolo_kar_verify`, and `knolo_cortex_verify`. Pins, policy, and the audit directory stay in the config file. Tool arguments cannot set the caller.

`knolo_search` writes an `openclaw-knolo-query-v1` receipt before it returns hits. Each hit carries an object id and the image state root. Each kept term is a whole word. Unquoted stopwords and terms shorter than 3 characters are dropped.

A receipt is an integrity check. It does not mean a claim is proven. Verification checks the image bytes, the state root, and the policy root.

`SATISFIED` from `knolo_kar_evaluate` means the evidence requirements in the plan were met. It does not mean a claim is proven.

The server does not download images, write knowledge, or call a model. An unwritable audit directory returns `AUDIT_UNAVAILABLE` and no hits.

Continuous integration checks that the draft is a stdio `npx` command for `@knolo/mcp@0.2.3` and that the file has no URL. It does not install the Goose app. The same fixture search the other host jobs run is what this command returns once Goose starts it.

Submitting the extension to the Goose directory is a separate pull request.

Server configuration is documented in the [`@knolo/mcp` README](../../packages/mcp/README.md).
