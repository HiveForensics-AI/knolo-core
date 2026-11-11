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

Create a skill, put one knowledge file in it, check it, and pack it.
`init` creates an empty `knowledge/` directory. An empty directory checks
with no receipt and packs no `knowledge.v5`.

```bash
knolo skill init refund-policy
printf '%s\n' 'Annual enterprise refunds are available within 30 days.' \
  > refund-policy/knowledge/policy.md
knolo skill check refund-policy
knolo skill pack refund-policy --out dist/refund-policy.knolo-skill
```

`check` searches the first words of that file. With the file above, those
words are `annual enterprise refunds`. It prints a receipt id that starts
with `sr_` and the image state root. `pack` then writes `knowledge.v5`
plus the image SHA-256 and state root in `manifest.json`.

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

## 4. A query returns a receipt id, and the next agent verifies the image

`knolo_search` returns hits and a receipt record: a receipt id (`qr_` plus
24 hex characters), the state root, the plan root, and the result root. The
server writes the receipt file in its audit directory before it returns
hits. That file stays on the machine that ran the query. MCP does not
return the file, and it has no tool that verifies it.

`knolo_verify` checks the mounted image bytes and V5 roots. A matching pin
stays valid. `knolo_get` reads one object at the state root from search.
The next agent proves which image it mounted by that pin and state root.

A receipt is an integrity check. It does not mean a claim is proven.
`SATISFIED` is not a search result from these tools, and it is not proof.
When a KAR check reports `SATISFIED`, the evidence requirements were met.
That does not mean the claim is true.

Each kept search term must appear as a whole word. An EQL `SEARCH` string
is a different matcher: every term is a substring.
