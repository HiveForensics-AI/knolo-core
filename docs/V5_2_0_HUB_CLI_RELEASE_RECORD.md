# V5.2 Hub CLI release record

**Status:** Local implementation complete; package release decision pending

**Date:** 2026-09-04

**Scope:** `@knolo/cli` Hub discovery, verified installation, local
credentials, and capability-boundary scaffolding

## Delivered CLI surface

The CLI now supports the additive Hub read path:

- `knolo search <query>` with format, license, official, agents, JSON, and
  registry filters;
- `knolo info <publisher>/<slug>` with human and unchanged JSON output;
- `knolo add <publisher>/<slug>[@<version>]` with manifest-first resolution;
- HTTPS Blob transfer with size and SHA-256 checks, no credential forwarding,
  and V4/V5 Knowledge Image validation;
- content-addressed cache files under `~/.knolo/cache/sha256/` and immutable
  digest pins in `knolo.lock.json`;
- `knolo login`, `whoami`, and `logout` using local `kno_` token storage;
- an honest `publish` boundary that exits with
  `Hub write APIs do not accept CLI tokens yet`.

The production origin is `https://hub.knolo.dev`. `--registry` and
`KNOLO_HUB_URL` support local or partner Hub testing. The existing local
`knolo add <name> <path>` behavior remains intact.

## Verification evidence

The deterministic test suite covers discovery, spec parsing, HTTP errors,
manifest and Blob failures, yanked versions, digest conflicts, V4/V5
validation, cache and lockfile behavior, secure credentials, command help,
and package tarball contents. The normal CLI test suite does not contact a
live Hub.

Run the optional live read-path smoke after seeding a local Hub with the
supplied Hub flow:

```bash
KNOLO_HUB_INTEGRATION=1 \
KNOLO_HUB_URL=http://localhost:3000 \
KNOLO_HUB_PACK=acme/refund-policy \
npm run test:hub --workspace @knolo/cli
```

Add `KNOLO_HUB_INSTALL=1` to exercise manifest, Blob, and local artifact
verification as well. CI remains independent of a deployed Hub.

## Release boundary

This work is additive and does not change the V4 or V5 artifact formats. Hub
Bearer authentication, CLI upload, draft/release/verify jobs, yank, and pull
increments remain Hub-owned follow-ups. The repository package metadata is
still `5.1.0`; changing the synchronized monorepo release line to `5.2.0`
requires the release-owner decision recorded in the internal V5.2 Hub CLI
integration plan.
