# Knolo release guide

The current npm release is **5.5.1**, tagged [`v5.5.1`](https://github.com/HiveForensics-AI/knolo-core/releases/tag/v5.5.1)
at `5111fc65f61073ee39cbe4923dc36dec760db5ed`. Those packages are already on
npm. Do not republish them.

- npm `5.5.1`: `@knolo/core`, `@knolo/cli`, `@knolo/langchain`,
  `@knolo/llamaindex`, `@knolo/semantic-ollama`, `create-knolo-app`
- PyPI `5.5.0`: `knolo` (the `5.5.1` tree is not on PyPI yet)
- crates.io `5.5.1`: `knolo-core-rust`, `knolo-icp-canister`

Rust and Python were not version-bumped for 5.5.1. V4 retrieval behavior
remains the compatibility path. The procedure below is the publication record
for this release line. The npm `5.5.1` and crates.io `5.5.1` uploads are
already complete. Do not rerun them. PyPI still has `knolo==5.5.0`. Section 4
records that failed upload. Section 5 is historical. Section 6 is verification
only.

## Release set

The V5 npm release set is `5.5.1`:

- `@knolo/core`
- `@knolo/cli`
- `@knolo/langchain`
- `@knolo/llamaindex`
- `@knolo/semantic-ollama`
- `create-knolo-app`

The Rust release set remains:

- `knolo-core-rust` `5.5.1`
- `knolo-icp-canister` `5.5.1`

The Python distribution remains `5.5.1` and provides read-only V5 Knowledge Image
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

Use `npm view <package>@5.5.1 version dist.tarball` to confirm each npm package.
Rust `5.5.1` is already published. Python on PyPI is still `knolo==5.5.0`. Do not upload either by hand.

## 4. Python package

PyPI has `knolo==5.5.0`. It does not have `knolo==5.5.1`. Do not run
`python -m build` or `twine upload` locally. Publication goes through
`.github/workflows/python-publish.yml` and Trusted Publishing.

The GitHub release `v5.5.1` checked out tag `v5.5.1`
(`5111fc65f61073ee39cbe4923dc36dec760db5ed`). That tag still says
`version = "5.5.0"`. The publish job uploaded `knolo-5.5.0` again, and PyPI
returned `400 File already exists`. The run is
https://github.com/HiveForensics-AI/knolo-core/actions/runs/38035566591.
The version string `5.5.1` was committed later and was not part of that tag.

`skip-existing: true` makes a later release succeed when the built version is
already on PyPI. A release or a manual run from a commit that contains
`version = "5.5.1"` uploads that version once. Knolo 6 does not change the
Python package version. It stays `5.5.1`.

Verify the package that is already on PyPI:

```bash
python -m pip index versions knolo
python_tmp="$(mktemp -d)"
python -m venv "$python_tmp"
"$python_tmp/bin/python" -m pip install --upgrade pip
"$python_tmp/bin/python" -m pip install --no-cache-dir knolo==5.5.0
"$python_tmp/bin/python" -c "import knolo; assert knolo.__version__ == '5.5.0'; print(knolo.__version__)"
```

## 5. Rust crates — historical, do not rerun

`knolo-core-rust` `5.5.1` and `knolo-icp-canister` `5.5.1` are already on
crates.io. Do not run `cargo publish` for these versions again. crates.io
rejects a second upload of the same version.

The publication already ran, in dependency order. Do not rerun it.

- `cargo login`, then a dry run and `cargo publish` for
  `packages/core-rust/Cargo.toml`.
- After `knolo-core-rust` `5.5.1` was indexed, a dry run and `cargo publish`
  for `packages/icp-canister/Cargo.toml`.

The ICP crate is the V5 release-line adapter but currently exposes the legacy
pack Candid API. Its V5 Knowledge Image integration is a later adapter wave.

## 6. Verify the published artifacts

These commands only read the registries. They do not publish npm packages,
PyPI distributions, or crates.

```bash
npm view @knolo/core@5.5.1 version
npm view @knolo/cli@5.5.1 version
python -m pip index versions knolo
curl -fsSL https://crates.io/api/v1/crates/knolo-core-rust/5.5.1
curl -fsSL https://crates.io/api/v1/crates/knolo-icp-canister/5.5.1
```
