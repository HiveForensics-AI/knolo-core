# langchain-basic

This adapter consumes the Knolo v4 TypeScript runtime and remains a thin
retriever wrapper; receipts and retrieval plans are available from
`@knolo/core`.

It remains V4-compatible while the V5 foundation is added beside the adapter;
V5 image inspection and Studio management are exposed by `@knolo/core` and
`@knolo/cli`, not by this LangChain wrapper. See the
[roadmap](../../docs/ROADMAP.md).

Minimal LangChain-style retrieval with `@knolo/langchain` (no `langchain` dependency required).

```bash
npm install
npm run start
```

---

## License

Apache-2.0
