# create-knolo-app

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

* Multiple starter templates
* Rust-powered builds
* Edge-runtime support
* Embedded device templates

---

## 📄 License

MIT

