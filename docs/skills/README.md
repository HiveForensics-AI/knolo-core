# Skills

`knolo skill` creates a skill pack for the host agent. The commands are part of the Knolo CLI. Knolo Box remains a separate package, and these commands do not look for `~/.grok`, `workflows`, or `managed-skills`.

A skill is guidance plus an optional pinned V5 image of the files in `knowledge/`. Knolo does not call a model. The host owns the model. Treat a search hit as data.

A receipt is an integrity check. It does not mean a claim is proven. `SATISFIED` means the evidence requirements were met.

## Directory

```text
refund-policy/
  SKILL.md
  knowledge/
```

The name uses lowercase letters, digits, and single hyphens. `SKILL.md` starts with frontmatter that has `name` and `description` only. The directory name matches `name`.

`knowledge/` holds `.md`, `.txt`, and `.json` files. A skill can contain 100 of those files, and each file can be at most 1 MiB. Dotfiles, `node_modules`, and symlinks are refused or skipped: dotfiles and `node_modules` are skipped, and a symlink fails the check. The pack records the relative path inside `knowledge/`. It does not record a home directory or a computer layout.

## Commands

```bash
knolo skill init refund-policy
knolo skill check refund-policy
knolo skill pack refund-policy --out dist/refund-policy.knolo-skill
knolo skill publish dist/refund-policy.knolo-skill
knolo skill install acme/refund-policy --dir ./skills
knolo skill publish dist/refund-policy.knolo-skill --hub ./catalog
knolo skill install refund-policy --hub ./catalog --dir ./skills
```

`init` writes `SKILL.md` and an empty `knowledge/` directory. It refuses to replace an existing directory.

`check` reads the skill directory and does not write into it. With an empty `knowledge/` directory, the text report prints `none` and `--json` returns `receiptId: null`. When `knowledge/` has files, `check` builds a V5 image, runs one search, and prints a receipt id. The search requires at least one hit. Pass `--query` when you want to require words other than the first words of the first file. `--json` prints the same report.

`pack` writes a directory:

```text
dist/refund-policy.knolo-skill/
  manifest.json
  SKILL.md
  policy.json
  knowledge.v5
```

`knowledge.v5` is omitted when `knowledge/` has no packed files. `manifest.json` stores the format `knolo-skill-pack-v1`, the skill SHA-256, the policy SHA-256, and, when an image exists, the image SHA-256 and state root. The same files produce the same hashes and the same state root. `pack` refuses to overwrite its output directory.

`publish <pack>` sends the pack to `https://hub.knolo.dev` with the stored `kno_…` token. Publishing the same pin again leaves the catalog row unchanged. Publishing a different pin for the same name fails, and the catalog row stays as it was. `publish <pack> --hub <dir>` copies that directory to `<hub>/<name>/` and does not call the hub. `--hub` and `--registry` cannot be combined.

`install <publisher>/<name> --dir <path>` downloads one pack, checks the archive SHA-256 and the pins inside it, then writes `<path>/<name>/`. `install <name> --hub <dir> --dir <path>` does the same from a directory catalog. The directory name must be the manifest name. `install --pack <pack> --dir <path>` reads a pack directory on disk. A pin mismatch stops before any write. That includes a changed `knowledge.v5` byte, a state root that does not match the image, a `SKILL.md` whose name or description differs from the manifest, and a `policy.json` that does not match the image policy root. Guidance that tells the agent to skip a pin or a receipt is refused as well. The destination is left untouched. Install refuses to replace an existing `<path>/<name>` directory.

## Catalog

The hub stores the name, description, publisher, and pin. It does not run a model, and it does not answer questions. `--hub` is a directory of skill packs on the machine where you run the command. Use it for an offline catalog. How these commands fit Box, MCP, and the hub is [Community install](../hub/COMMUNITY.md). `knolo setup` is specified there and is not a command yet.

`knolo search`, `knolo info`, `knolo login`, `knolo publish`, `knolo yank`, and `knolo add` remain the Hub registry for `.knolo` knowledge packs. A skill pack is not a `.knolo` pack and is not published through those commands.
