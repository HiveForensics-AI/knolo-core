# nextjs-rag-chat

The scaffold targets Knolo v4 packs and the TypeScript TrustBench reference
runtime. Use the CLI’s `--receipt` option when the application needs verifiable
retrieval evidence.

The generated app can adopt the V5 foundation without changing its V4
retrieval path; use `knolo v5 info`, `knolo v5 health`, or `knolo v5 studio` for
read-only Knowledge Image operations. See the [roadmap](../../docs/ROADMAP.md).

Use the published-style scaffold package from this monorepo:

```bash
npm install
npx create-knolo-app my-kb-chat
```

Then inside `my-kb-chat` run:

```bash
npm install
npm run knolo:build
npm run dev
```

---

## License

Apache-2.0
