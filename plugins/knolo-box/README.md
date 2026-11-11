# knolo-box

Grok Build plugin for a pinned knowledge image of a Grok Bot computer. One command installs the skill and the MCP server:

```bash
grok plugin install HiveForensics-AI/knolo-core#plugins/knolo-box --trust
```

`--trust` is required so the skill and the MCP server load. Node.js 20 or newer must already be on `PATH`.

npm `latest` is `@knolo/box@0.1.1`. The plugin command is `npx -y @knolo/box@0.1.1 mcp`. To run this checkout, use the workspace binary:

```bash
node packages/box/bin/knolo-box.mjs build
node packages/box/bin/knolo-box.mjs mcp
```

`mcp` starts `knolo-mcp` with the primary config and inherits stdio. It does not proxy JSON-RPC.

When the computer is not `~/.grok`, run `node packages/box/bin/knolo-box.mjs init --config <file>` before `build`. `init` follows symlinks and requires one real workflows directory and one real managed-skills directory. It writes one memory directory and one sessions directory when it finds exactly one of each, and leaves a scope empty when it finds none or several. `--skills` and `--managed-skills` skip detection for that role. Empty memory, transcripts, and files roots are not searchable. `mcp --config <file>` reads that box config and starts `knolo-mcp` with `<output>/knolo-mcp.json`. The host keeps its own connector record. `knolo_search` lowercases the query, keeps quoted phrases whole, treats unquoted `OR` as any term, and drops unquoted stopwords and terms shorter than 3 characters. Each kept term must be a whole word. `match` is `all`, `any`, `partial`, or `none`. EQL `SEARCH` still requires every term as a substring and stays in object id order. The config shape and the stopword list are in [the box doc](../../docs/box/README.md).

From the Plugins UI, add the marketplace `HiveForensics-AI/knolo-core`, install `knolo-box`, and trust it when asked.

The tool behavior is in [the skill](skills/knolo-box/SKILL.md). The layout is in [the box doc](../../docs/box/README.md). Package details are in the [@knolo/box README](../../packages/box/README.md).

Repository code stays on the [knolo-code plugin](../knolo-code/README.md).
