# Anthropic Agent Skills

The Knolo Agent Skill tells the host to answer through the mounted Knolo
tools and cite the roots those tools return. The Claude Code plugin in
[`plugins/knolo`](../../plugins/knolo/README.md) bundles that skill and
registers published `@knolo/mcp@0.2.3` over stdio. Knolo does not call a model
and does not open a port.

Set `KNOLO_MCP_CONFIG` to an absolute `knolo-mcp.json`. Pins, a policy file,
and an audit directory stay in that file. Tool arguments cannot set the
caller.

The skill `name` is `knolo`, matching `skills/knolo/SKILL.md` inside the
plugin. Claude Code rejects a path that leaves the plugin directory. The
three grounding paragraphs are the same text as
[`packages/openclaw/skills/knolo-grounding/SKILL.md`](../../packages/openclaw/skills/knolo-grounding/SKILL.md).

An agent answers with `knolo_search`, `knolo_get`, `knolo_verify`, and
`knolo_status`. Those tools enforce the pin, the policy, and the audit
directory. Cite `imageId`, `objectId`, and `stateRoot`. A receipt is an
integrity check. It does not mean a claim is proven.

An operator can verify a fixture image with the workspace CLI or published
`@knolo/cli@6.2.5`. `v5 query` does not apply the mount policy and does not
write the audit receipt. It is not a substitute for `knolo_search`.

```bash
node packages/cli/bin/knolo.mjs verify /absolute/support.v5
node packages/cli/bin/knolo.mjs v5 query /absolute/support.v5 'FROM chunk SEARCH "refunds" LIMIT 5' --json --receipt /absolute/query-result.json
```

The `--receipt` file holds `stateRoot`, `planRoot`, `resultRoot`, and hits.
That file is an integrity check. Cite `stateRoot`, `resultRoot`, and
`objectId`. It does not mean a claim is proven.

`SATISFIED` means evidence requirements were met. It does not mean a claim is
proven.

The offline check is:

```bash
node plugins/knolo/skills/knolo/scripts/query-fixture.mjs
```

It builds a fixture image, verifies it, and runs one query. The upstream
listing pull request to `anthropics/skills` is separate. This repository does
not open it.

Server configuration is documented in the
[`@knolo/mcp` README](../../packages/mcp/README.md).
