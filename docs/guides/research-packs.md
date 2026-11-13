# Research packs

A research pack is a V5 Knowledge Image built from files that are already
on disk. The host supplies the caller. Knolo does not call a model, does
not download an image, and does not run the agent.

```bash
knolo research package \
  --question "Annual enterprise refunds are available within 30 days." \
  --agent reviewer \
  --source notes.md \
  --source policy.md \
  --out dist/research.knolo
```

The image stores the question, one chunk per source, and the SHA-256 of
each source file. The same inputs write the same bytes. An existing output
path, a missing source, or a source over the text cap writes nothing.

To pack a Cortex trace, pass the image that produced it and the trace file
together. A trace that records KAR evaluations also needs `--graph`, the
same file `knolo cortex verify` would use. The plan stays inside the trace.
The trace is checked before the pack is written. A failed check writes
nothing. The packed trace is that receipt. It is an integrity check. It
does not mean a claim is proven. `SATISFIED` means the evidence requirements
in the trace were met.

```bash
knolo research package \
  --question "What did the inspection find?" \
  --agent reviewer \
  --source notes.md \
  --cite cite.knolo \
  --trace answer.cortex.json \
  --graph knowledge.kar.json \
  --out dist/research.knolo
```

The second agent mounts the finished image with the existing read-only
server. The server does not download the image and does not run the
research.

```bash
npx -y @knolo/mcp@0.2.3 --config /absolute/knolo-mcp.json
```

`knolo_search` keeps each remaining term as a whole word. This command does
not add a Hub tool, a publish tool, or a write tool.

`knolo search <query> --research` asks Hub for packs whose latest image has
metadata `role: research-pack`. `--agents` stays the agent-definition
namespace. Pin a result with `knolo add`. Queries still run after mount.

Two skill packs install with the existing skill commands. They tell the host
to search a pinned image, cite the receipt, package with `knolo research
package`, and share the digest from `knolo verify`.

```bash
knolo skill check examples/skills/research-and-cite
knolo skill check examples/skills/share-findings
knolo skill pack examples/skills/research-and-cite --out dist/research-and-cite
knolo skill pack examples/skills/share-findings --out dist/share-findings
knolo skill publish dist/research-and-cite --hub ./catalog
knolo skill publish dist/share-findings --hub ./catalog
knolo skill install research-and-cite --hub ./catalog --dir ./skills
knolo skill install share-findings --hub ./catalog --dir ./skills
```

`--hub ./catalog` is a directory on this machine. This guide does not log in
or publish to the public registry.

See [Two agents sharing knowledge](agents-sharing-knowledge.md).
