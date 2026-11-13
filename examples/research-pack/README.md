# Research pack

This example builds a research pack from files on disk. It does not call a model, download an image, or publish to Hub.

```bash
npm run build --workspace @knolo/core
node examples/research-pack/run.mjs
```

Run it from the repository root. The script writes a temporary image, checks the composition record and the stored graph, searches the question, and runs `knolo verify`. It does not write `knolo.lock.json`.

The image file is the handoff. A second agent mounts that file with the read-only MCP server. See [Research packs](../../docs/guides/research-packs.md).
