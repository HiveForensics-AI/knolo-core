# Two agents sharing knowledge

Knolo is the open framework AI agents use to share knowledge with one
another: pack it into a portable Knowledge Image, pin it by digest, mount
it locally, and prove what was used.

Knolo does not call a model, and it does not run either agent. The host
owns the model. A search hit is data. A receipt is an integrity check. It
does not mean a claim is proven.

The `description` fields in this repository use that wording. npm still
shows the previous descriptions until a later publish.

## 1. Pack knowledge or install a skill

Create a skill, check it, and pack it:

```bash
knolo skill init refund-policy
knolo skill check refund-policy
knolo skill pack refund-policy --out dist/refund-policy.knolo-skill
```

Or install a skill that is already on the hub:

```bash
knolo skill install acme/refund-policy
```

Install checks the archive SHA-256 and the pins inside the pack, then writes
the skill under `~/.knolo/skills` unless `--dir` says otherwise. The download
does not send a token.

A `.knolo` knowledge pack is a different catalog. Install one with
`knolo add`. Skill packs are not published with `knolo publish`.

Box can turn a host agent's local skills into a pinned image:

```bash
knolo-box build
```

The commands, limits, and pin rules are in [Skills](../skills/README.md).
How Hub, Box, and MCP fit together is in
[Community hub](../hub/COMMUNITY.md).

## 2. Publish or pin by digest

Publish the skill pack to the hub:

```bash
knolo skill publish dist/refund-policy.knolo-skill
```

That send goes to `https://hub.knolo.dev` and needs a stored publish token.
Publishing the same pin again leaves the catalog row unchanged. A different
pin for the same name is refused.

For a directory on this machine, pass `--hub`:

```bash
knolo skill publish dist/refund-policy.knolo-skill --hub ./catalog
```

`--hub` does not call the hub. The hub stores the pack and the pin. It does
not run a model, and it does not answer questions.

The pin is the digest. A skill pack records the image SHA-256 and the state
root when `knowledge/` has files. A V5 image is also identified by its
`stateRoot`. Mount the bytes that match that pin.

## 3. The second agent mounts the image

The usual path is MCP. The image is already on disk. The server does not
download it.

```bash
npx -y @knolo/mcp@0.2.3 --config /absolute/knolo-mcp.json
```

The server speaks stdio. It does not open a port. The caller is `agentId`
in the config file. Tool arguments cannot set it. That id must be listed in
the mount's `agents` array.

`@knolo/mcp@0.2.3` is the published server. Pins, policy checks, and
receipts come from `@knolo/tools`. Details are in the
[MCP README](../../packages/mcp/README.md). Box starts that same server
after a build. See the [Box README](../../packages/box/README.md).

## 4. A query returns a receipt the next agent can verify

`knolo_search` returns hits, a receipt id (`qr_` plus 24 hex characters),
and the state root. The server writes the receipt before it returns hits.
`knolo_verify` checks the mounted image. `knolo_get` reads one object.

A receipt is an integrity check. It does not mean a claim is proven.
`SATISFIED` is not a search result from these tools, and it is not proof.
When a KAR check reports `SATISFIED`, the evidence requirements were met.
That does not mean the claim is true.

Each kept search term must appear as a whole word. An EQL `SEARCH` string
is a different matcher: every term is a substring.
