# Knolo Claude Code plugin

This plugin loads the Knolo Agent Skill and registers the published Knolo MCP
server. `@knolo/mcp@0.2.2` is the npm release. The server is stdio. It does
not listen on a port.

Set `KNOLO_MCP_CONFIG` to an absolute `knolo-mcp.json` before Claude Code
starts the server. The file must pin each Knowledge Image, name a policy
file, and name an audit directory. Tool arguments cannot set the caller.

The skill is `skills/knolo/SKILL.md` inside this plugin. Its `name` is
`knolo`. The three grounding paragraphs match
`packages/openclaw/skills/knolo-grounding/SKILL.md`. Claude Code rejects a
skill path that leaves the plugin directory, so this copy lives here.

The agent answers through `knolo_search`, `knolo_get`, `knolo_verify`, and
`knolo_status`. Those tools enforce the pin, the policy, and the audit
directory. Cite `imageId`, `objectId`, and `stateRoot`. A receipt is an
integrity check.

`node plugins/knolo/skills/knolo/scripts/query-fixture.mjs` is an operator
check. It verifies a fixture image and runs one `v5 query`. That command does
not apply a mount policy and does not write the audit receipt, so it is not
the path an agent uses to answer. The `--receipt` file holds `stateRoot`,
`resultRoot`, and `objectId`. `SATISFIED` means evidence requirements were
met. It does not mean a claim is proven.

The upstream pull request to `anthropics/skills` is separate. This repository
does not open it.

The integration note is
[Anthropic Agent Skills](../../docs/integrations/anthropic-skills.md).
