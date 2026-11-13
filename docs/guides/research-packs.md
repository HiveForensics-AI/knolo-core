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
together. The trace is checked with the existing Cortex verification before
the pack is written. A failed check writes nothing. The packed trace is
that receipt. It is an integrity check. It does not mean a claim is proven.
`SATISFIED` means the evidence requirements in the trace were met.

```bash
knolo research package \
  --question "What did the inspection find?" \
  --agent reviewer \
  --source notes.md \
  --cite cite.knolo \
  --trace answer.cortex.json \
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

See [Two agents sharing knowledge](agents-sharing-knowledge.md).
