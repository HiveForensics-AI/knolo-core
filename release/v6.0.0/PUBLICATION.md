# Publication

Do not run these commands until a person authorizes publication. This file does not publish anything.

Inspected on 2026-10-11, without publishing:

| Package | npm `latest` | `6.0.0-rc.1` on npm |
| --- | --- | --- |
| `@knolo/core` | `5.5.1` | not published |
| `@knolo/cli` | `5.5.1` | not published |
| `@knolo/langchain` | `5.5.1` | not published |
| `@knolo/llamaindex` | `5.5.1` | not published |
| `@knolo/semantic-ollama` | `5.5.1` | not published |
| `create-knolo-app` | `5.5.1` | not published |
| `@knolo/reflex` | `0.2.0` | not applicable |
| `@knolo/evidence-gate` | `0.1.0` | not applicable |

`6.0.0-rc.1` is a git prerelease. Do not publish it, and do not point `latest` at it.

`npm publish` applies the `latest` dist-tag by default. Use that default for `6.0.0` only when publication is authorized. Do not pass `--tag next` for the GA packages.

## Order

Derived from `package.json` dependencies:

1. `@knolo/core` has no `@knolo` dependency. Publish it first.
2. These packages depend on `@knolo/core` and not on each other. Publish them after core, in any order:
   - `@knolo/cli`
   - `@knolo/langchain`
   - `@knolo/llamaindex`
   - `@knolo/semantic-ollama`
3. `create-knolo-app` has no runtime `@knolo` dependency. Its template names `@knolo/core` and `@knolo/cli`, so publish it after those two exist on the registry.

## Do not republish immutable versions

`@knolo/reflex@0.2.0` and `@knolo/evidence-gate@0.1.0` are already `latest` on npm. npm versions are immutable. Do not run `npm publish` for those versions.

The published registry copies depend on `@knolo/core` version `5.5.0` exactly. The git tree now declares `^6.0.0` for local workspace use. Shipping that range on npm requires a new version of each package. This GA does not cut that version.

`knolo-core-rust`, the ICP canister, and Python `knolo` stay `5.5.0`. They do not implement V6 KAR. Do not publish them as if they did.

## Commands

Run from the tagged commit, after `npm login` to the intended registry. Stop if the version already exists.

```bash
npm publish --workspace @knolo/core --access public
npm publish --workspace @knolo/cli --access public
npm publish --workspace @knolo/langchain --access public
npm publish --workspace @knolo/llamaindex --access public
npm publish --workspace @knolo/semantic-ollama --access public
npm publish --workspace create-knolo-app --access public
```

Confirm `npm view @knolo/core dist-tags` shows `latest` = `6.0.0` only after that publish. Then run [POST_PUBLISH_SMOKE.md](POST_PUBLISH_SMOKE.md).
