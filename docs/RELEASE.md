# Knolo release guide

The current npm release is **5.5.1**, tagged [`v5.5.1`](https://github.com/HiveForensics-AI/knolo-core/releases/tag/v5.5.1)
at `5111fc65f61073ee39cbe4923dc36dec760db5ed`. Those packages are already on
npm. Do not republish them.

- npm `5.5.1`: `@knolo/core`, `@knolo/cli`, `@knolo/langchain`,
  `@knolo/llamaindex`, `@knolo/semantic-ollama`, `create-knolo-app`
- PyPI `5.5.0`: `knolo`
- crates.io `5.5.0`: `knolo-core-rust`, `knolo-icp-canister`

Rust and Python were not version-bumped for 5.5.1. V4 retrieval behavior
remains the compatibility path. The procedure below is the publication record
for this release line; the npm 5.5.1 upload is already complete.

## Release set

The V5 npm release set is `5.5.1`:

- `@knolo/core`
- `@knolo/cli`
- `@knolo/langchain`
- `@knolo/llamaindex`
- `@knolo/semantic-ollama`
- `create-knolo-app`

The Rust release set remains:

- `knolo-core-rust` `5.5.0`
- `knolo-icp-canister` `5.5.0`

The Python distribution remains `5.5.0` and provides read-only V5 Knowledge Image
verification and lexical object queries while preserving its legacy V1–V3
pack APIs. It does not provide V5 writes, Studio, authority administration,
or synchronization.

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

`5.5.1` is already published. Do not run these publish commands again for that
version. They are the record of the upload that produced the current npm line.

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
npm install @knolo/core@5.5.1 @knolo/cli@5.5.1
npx knolo --help
node --input-type=module -e "import('@knolo/core').then(m => console.log(typeof m.verifyKnowledgeImageV5))"
```

Use `npm view <package>@5.5.1 version dist.tarball` to confirm each npm package
is available before moving to the next ecosystem.

## 4. Python package publication through GitHub

Python is now part of the V5 read-only verifier/query profile. The repository's
`python-ci` workflow must be green before publication. The build and upload are
performed by `python-publish` from the GitHub web UI; do not run a local
`python -m build` or `twine upload` as the publication step.

Push the release commit and confirm the branch checks:

```bash
git push origin feat/vqf1-compression
```

Python `5.5.0` was published from tag `v5.5.0`. Tag `v5.5.1` is the npm release
and does not change the Python version. Publishing that GitHub release still
starts `python-publish` for the Python version on the tagged commit
(`knolo==5.5.0`), which is already on PyPI.

In GitHub, open **Releases → Draft a new release**, choose or create tag
`v5.5.0` at the Python release commit, then select **Publish release**. This
published release starts `python-publish`, which builds `knolo==5.5.0`, runs
`twine check`, and uploads it to PyPI through the configured `pypi` environment
and Trusted Publishing. Wait for both workflow jobs to pass before continuing.

Verify the package from a clean environment:

```bash
python -m pip index versions knolo
python_tmp="$(mktemp -d)"
python -m venv "$python_tmp"
"$python_tmp/bin/python" -m pip install --upgrade pip
"$python_tmp/bin/python" -m pip install --no-cache-dir knolo==5.5.0
"$python_tmp/bin/python" -c "import knolo; assert knolo.__version__ == '5.5.0'; print(knolo.__version__)"
```

## 5. Publish Rust crates

After the GitHub Python workflow and PyPI verification pass, publish the Rust
crates in dependency order:

```bash
cargo login
cargo publish --manifest-path packages/core-rust/Cargo.toml --dry-run
cargo publish --manifest-path packages/core-rust/Cargo.toml
```

Wait for `knolo-core-rust 5.5.0` to be indexed, then publish the adapter:

```bash
cargo publish --manifest-path packages/icp-canister/Cargo.toml --dry-run
cargo publish --manifest-path packages/icp-canister/Cargo.toml
```

The ICP crate is the V5 release-line adapter but currently exposes the legacy
pack Candid API. Its V5 Knowledge Image integration is a later adapter wave.

## 6. Verify the release

After npm, PyPI, and crates.io publication, verify the package registries and
record the GitHub release URL in the release notes:

```bash
npm view @knolo/core@5.5.1 version
npm view @knolo/cli@5.5.1 version
python -m pip index versions knolo
curl -fsSL https://crates.io/api/v1/crates/knolo-core-rust/5.5.0
curl -fsSL https://crates.io/api/v1/crates/knolo-icp-canister/5.5.0
```
