# Knolo V5 release guide

This guide publishes the V5 foundation runtime as `5.0.0` while preserving the
existing V4 retrieval behavior.

## Release set

The V5 npm release set is:

- `@knolo/core`
- `@knolo/cli`
- `@knolo/langchain`
- `@knolo/llamaindex`
- `@knolo/semantic-ollama`
- `create-knolo-app`

The Rust release set is:

- `knolo-core-rust` `5.0.0`
- `knolo-icp-canister` `5.0.0`

The Python distribution remains a legacy V1–V3 reader/query profile at
`4.0.0`. It must not be published as a V5 runtime until it consumes the V5
Knowledge Image contracts.

## 1. Clean-room preflight

Run these commands from the repository root on the release branch:

```bash
git status --short
npm ci
npm run release:check
npm test
npm run trustbench:test
cargo test --manifest-path packages/core-rust/Cargo.toml
cargo test --manifest-path packages/icp-canister/Cargo.toml
bash scripts/check-icp-template-sync.sh
cargo build --target wasm32-unknown-unknown --release --manifest-path packages/icp-canister/Cargo.toml
```

The working tree should be clean after review, apart from intentional release
changes. `release:check` verifies V5 exports, package metadata, artifact
separation, CLI registration, and KIP coverage.

## 2. Inspect package contents

Build the distributable artifacts and inspect the exact files before upload:

```bash
npm run build --workspaces --if-present
npm pack --workspace @knolo/core --dry-run
npm pack --workspace @knolo/cli --dry-run
npm pack --workspace @knolo/langchain --dry-run
npm pack --workspace @knolo/llamaindex --dry-run
npm pack --workspace @knolo/semantic-ollama --dry-run
npm pack --workspace create-knolo-app --dry-run

cargo package --manifest-path packages/core-rust/Cargo.toml --allow-dirty --no-verify --list
cargo package --manifest-path packages/icp-canister/Cargo.toml --allow-dirty --no-verify --list
```

For a final clean-tree release, remove `--allow-dirty` and run the package
commands after committing the release changes.

## 3. Publish npm packages

Authenticate to the intended npm account or organization first:

```bash
npm whoami
npm login
```

Publish the core first, then packages that depend on it:

```bash
npm publish --workspace @knolo/core --access public
npm publish --workspace @knolo/cli --access public
npm publish --workspace @knolo/langchain --access public
npm publish --workspace @knolo/llamaindex --access public
npm publish --workspace @knolo/semantic-ollama --access public
npm publish --workspace create-knolo-app
```

Verify the release from a clean temporary project:

```bash
tmp_dir="$(mktemp -d)"
cd "$tmp_dir"
npm init -y
npm install @knolo/core@5.0.0 @knolo/cli@5.0.0
npx knolo --help
node --input-type=module -e "import('@knolo/core').then(m => console.log(typeof m.verifyKnowledgeImageV5))"
```

Use `npm view <package>@5.0.0 version dist.tarball` to confirm each package is
available before moving to the next ecosystem.

## 4. Publish Rust crates

Authenticate to crates.io, then publish the core crate before the ICP adapter:

```bash
cargo login
cargo publish --manifest-path packages/core-rust/Cargo.toml --dry-run
cargo publish --manifest-path packages/core-rust/Cargo.toml
```

Wait for `knolo-core-rust 5.0.0` to be indexed, then publish the adapter:

```bash
cargo publish --manifest-path packages/icp-canister/Cargo.toml --dry-run
cargo publish --manifest-path packages/icp-canister/Cargo.toml
```

The ICP crate is the V5 release-line adapter but currently exposes the legacy
pack Candid API. Its V5 Knowledge Image integration is a later adapter wave.

## 5. Python package boundary

Python is intentionally not part of the V5 runtime publication. Its safe
validation commands are:

```bash
cd packages/core-python
python -m pip install -e ".[dev]"
python -m pytest
python_dist="$(mktemp -d)"
python -m build --outdir "$python_dist" .
python -m twine check "$python_dist"/*
```

Do not run `python -m twine upload` for this V5 release. Publish a new Python
version only after the Python implementation supports and passes the shared V5
fixtures; see [`packages/core-python/RELEASE.md`](../packages/core-python/RELEASE.md).

## 6. GitHub release

After the package registries are verified:

```bash
git tag -a v5.0.0 -m "Knolo V5 foundation"
git push origin v5.0.0
```

Create a GitHub release from `v5.0.0` and include the V5 foundation scope,
V4 compatibility statement, registry links, and the Python/ICP boundaries
above. The existing Python publish workflow is release-triggered, so do not
publish a GitHub release until its package decision is intentional.
