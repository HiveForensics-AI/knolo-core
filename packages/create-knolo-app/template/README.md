# Knolo V5-compatible application template

This generated app depends on `@knolo/core` `^6.0.0` and `@knolo/cli` `^6.0.0`.
The default application workflow is the V4-compatible retrieval path. The V5
foundation is available beside that path. Use the CLI’s inspect and verify
commands for V4 artifacts, and `knolo v5 info`, `knolo v5 health`, or
`knolo v5 studio` for read-only V5 Knowledge Images. Composition is available
from `@knolo/core/composition` once `@knolo/core` resolves to `6.1.0` or later.
Knolo Cortex is `@knolo/core/cortex` in `6.2.0`.

```bash
npm install
npm run knolo:build
npm run dev
```

Open http://localhost:3000 and ask questions about files in `./docs`.

The repository roadmap is maintained in the Knolo source repository at
[`docs/ROADMAP.md`](https://github.com/HiveForensics-AI/knolo-core/blob/main/docs/ROADMAP.md).

## License

Apache-2.0
