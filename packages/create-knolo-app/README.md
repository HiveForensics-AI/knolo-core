# create-knolo-app

This package is `6.2.0`. Generated applications depend on `@knolo/core`
`^6.0.0` and `@knolo/cli` `^6.0.0`. Those ranges can resolve the published
`6.2.0` packages. `@knolo/cli` `6.2.0` itself requires `@knolo/core` `^6.2.0`.
Generated applications target the Knolo V4 TypeScript retrieval path, with the
V5 foundation available beside it. Packs are V4 by default and can be checked
with `knolo verify`. Python, Rust, and ICP stay `5.5.1` and do not implement
KAR, composition, or Cortex.

V5 Knowledge Image inspection is available after generation with
`knolo v5 info`, `knolo v5 health`, and `knolo v5 studio`. See the
[implementation roadmap](../../docs/ROADMAP.md).

Bootstrap a new KnoLo-powered application in seconds.

Creates a Next.js app preconfigured with:

- `@knolo/core`
- `@knolo/cli`
- Knowledge folder
- Build scripts
- Example agents
- Example namespaces

---

## 🚀 Usage

```bash
npx create-knolo-app my-app
cd my-app
npm install
npm run dev
```

First-time build:

```bash
npm run knolo:build
```

---

## 📁 Generated Structure

```
my-app/
  knowledge/
  dist/
  knolo.config.ts
  package.json
  app/
```

---

## 🧠 What You Get

* Working Next.js playground
* Deterministic knowledge querying
* Agent resolution examples
* Example structured documents
* Fully local-first setup

---

## 📦 Included Scripts

```json
{
  "scripts": {
    "dev": "next dev",
    "knolo:build": "knolo build"
  }
}
```

---

## 🔍 Example Query

```ts
query(pack, {
  namespace: "mobile",
  q: "react native bridge"
});
```

---

## 🤖 Agent Support

Includes example agent definitions with:

* System prompts
* Tool policies
* Routing metadata
* Patch variables

You can experiment directly in the playground UI.

---

## 🎯 Ideal For

* Building AI apps without vector DBs
* Mobile-first AI
* On-device LLM experiments
* Deterministic AI systems
* Agent routing research

---

## 🗺 Roadmap

The active roadmap is maintained in [`../../docs/ROADMAP.md`](../../docs/ROADMAP.md).
The starter currently generates the stable V4 retrieval path; V5 image
inspection can be added without changing that application behavior.

---

## 📄 License

Apache-2.0
