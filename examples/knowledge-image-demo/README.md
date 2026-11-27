# Knowledge Image Demo

This browser-only Vite app demonstrates local V5 Knowledge Image verification,
mounting, and chunk search. It does not use the legacy ICP canister example.

## Run

From the repository root:

```bash
npm install
npm run build --workspace @knolo/core
cd examples/knowledge-image-demo
npm install
npm run dev
```

The `predev` script generates `public/demo-image.v5` from
`scripts/build-fixture.mjs`. The app verifies and mounts that fixture on page
load. Select another valid V5 image and choose **Verify and mount** to replace
it.

## Test and build

```bash
npm test
npm run build
```

Tests cover fixture verification, malformed image rejection, source-linked
query snippets, and no-match results.
