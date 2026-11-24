Set `config_path` to the absolute path of a Knolo MCP config that points at a pinned local Knowledge Image.

The extension starts `npx -y @knolo/mcp@0.2.4 --config` with that path. A missing or empty `config_path` fails closed. The extension does not install a newer npm release. The server does not listen on a port. There is no remote URL.
