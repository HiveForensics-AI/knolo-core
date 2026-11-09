# knolo-code

Grok Build plugin for a local code Knowledge Image. One command installs the skill and the MCP server:

```bash
grok plugin install HiveForensics-AI/knolo-core#plugins/knolo-code --trust
```

`--trust` is required so the skill and the MCP server load. Node.js 20 or newer must already be on `PATH`. The server runs `npx -y @knolo/code@0.1.1 mcp`. The first start downloads the package. If that start is marked failed, set `MCP_TIMEOUT=120000` and reload MCP servers.

From the Plugins UI, add the marketplace `HiveForensics-AI/knolo-core`, install `knolo-code`, and trust it when asked.

`@knolo/code@0.1.1` is on npm. `npx -y @knolo/code@0.1.1 mcp` downloads that release. The measured check is in [the code image doc](../../docs/code/README.md).

The tool behavior is in [the skill](skills/knolo-code/SKILL.md). Package details are in the [@knolo/code README](../../packages/code/README.md).
