# llamaindex-basic

This adapter consumes the Knolo V4 TypeScript retrieval path and remains a thin
retriever wrapper. Receipts and retrieval plans come from `@knolo/core`.

`@knolo/llamaindex` is `6.1.0` and depends on `@knolo/core` `^6.0.0`. V5 image
inspection and Studio management stay on `@knolo/core` and `@knolo/cli`.
Composition is `@knolo/core/composition`, not this wrapper. See the
[roadmap](../../docs/ROADMAP.md).

Minimal LlamaIndex-style retrieval with `@knolo/llamaindex` (no `llamaindex` dependency required).

```bash
npm install
npm run start
```

---

## License

Apache-2.0
