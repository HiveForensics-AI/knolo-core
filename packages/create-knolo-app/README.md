# create-knolo-app

Generated applications target the Knolo V4 TypeScript retrieval path, with the
V5 foundation available beside it. Packs are V4 by default and can be checked
with `knolo verify`; Python and ICP remain legacy profiles, while Rust provides
the native V5 verification foundation.

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
