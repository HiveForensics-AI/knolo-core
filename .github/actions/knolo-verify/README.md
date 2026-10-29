# Knolo Verify

Composite action that runs a pinned `@knolo/cli` over committed Knolo artifacts. It does not add verification rules, build packs, call a model, or talk to Hub.

Verification checks integrity against declared evidence. It does not mean a claim is true. A KAR status of `SATISFIED` means evidence requirements were met. It does not mean a claim is proven.

`knolo kar conformance` is not included. That command runs from a knolo-core checkout.

## Usage

```yaml
name: knolo-verify
on: pull_request
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: HiveForensics-AI/knolo-core/.github/actions/knolo-verify@<commit>
        with:
          cli-version: 6.2.0
          packs: dist/*.knolo
          images: dist/knowledge.v5
          kar-graphs: dist/knowledge.v5=dist/knowledge.kar.json
          attestations: attestations/cited.json
          attestation-args: --public-key keys/pub.json --now 1761465600000
          cortex-traces: dist/knowledge.v5=traces/answer.cortex.json
          diff-base: origin/main
```

`cli-version` is required and must be an exact version. The action installs it with `npm install --global --ignore-scripts`. Node defaults to 20.

Paths are newline-separated. `*` and `**` globs are expanded in the workspace. Pair fields use `=` and do not expand globs. `diff-base` diffs each selected pack against that git ref. The ref must already resolve to a commit in the checkout, so a shallow checkout needs `fetch-depth: 0` or an earlier fetch before `origin/main` can be used. A ref that is not a commit fails the job. A pack that is absent from a resolved ref is `changed`, or `fail` when `fail-on-diff` is true. `fail-on-diff` defaults to `false`, so a diff that reports changes is a `changed` row and does not fail the job until you set it to `true`.

The job summary is a table of artifact, check, result, and root. `passed` is `true` or `false`. `results` is the path of a new JSON file for that step. Two steps in one job do not share it.

Checks:

| Input                     | Command                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| `packs`                   | `knolo verify`                                                         |
| `images`                  | `knolo v5 health`                                                      |
| `kar-packages`            | `knolo kar package verify`                                             |
| `kar-graphs`              | `knolo kar graph check --image <image> --graph <file>`                 |
| `kar-dossiers`            | `knolo kar dossier verify`                                             |
| `kar-coverage`            | `knolo kar coverage verify`                                            |
| `compositions`            | `knolo compose verify`                                                 |
| `attestations`            | `knolo verify-attestation`                                             |
| `cortex-traces`           | `knolo cortex verify --image <image> --answer <file> [--graph <file>]` |
| `diff-pairs`, `diff-base` | `knolo diff` for V4 packs                                              |
| `kar-graph-diffs`         | `knolo kar graph diff`                                                 |

`knolo v5 health` fails when the process exits non-zero or the JSON `healthy` field is not `true`. Pack verify fails when `verified` is not `true`.
