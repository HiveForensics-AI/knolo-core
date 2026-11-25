# skills

Example [Claude Code skills](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/skills)
for agents that use a pinned Knolo Knowledge Image. Each skill is a directory
with a `SKILL.md` and a `knowledge/` folder.

## research-and-cite

Search a pinned Knowledge Image, cite the receipt id, and package the
findings with `knolo research package`.

Steps:

1. Search the pinned image before answering.
2. Include the receipt id in the reply.
3. Package the files with `knolo research package`. Pass `--cite` and
   `--trace` together when a Cortex trace exists. Pass `--graph` when
   the trace records KAR evaluations.
4. Leave publishing to `knolo publish` after `knolo verify`.

Receipts are integrity checks, not truth claims. `SATISFIED` means the
evidence requirements were met.

## share-findings

Share a verified research pack by file SHA-256 and state root so another
agent can pin it.

Steps:

1. Run `knolo verify` on the research pack before sharing.
2. Share the file, the SHA-256 of those bytes, and the state root.
3. The receiver runs `knolo research verify <image>` to check it.
4. The other agent pins the file with `knolo add` and verifies before
   mounting.
5. Include the receipt id when a search of the mounted image is used.

Discover research packs with `knolo search "<query>" --research`.

## Install

Copy a skill directory into `.claude/skills/` in your project, or register
it with the Claude Code CLI. Both skills reference `@knolo/cli` commands
and the `@knolo/mcp` server.

## Related

- [Anthropic Skills integration](../../docs/integrations/anthropic-skills.md)
- [`@knolo/cli`](../../packages/cli/README.md) for `knolo verify`, `knolo add`,
  and `knolo research`
- [`@knolo/mcp`](../../packages/mcp/README.md) for the MCP server

---

## License

Apache-2.0
