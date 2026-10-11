# operations-demo

Redistributable hand-authored example. It is not a customer procedure and it is not universal operations coverage.

`plan.json` asks for the close-valve requirement. That evaluation is `SATISFIED`.

`gap/` asks for `missing-permit`. The committed graph does not bind that requirement, so the status is `UNSATISFIED_EVIDENCE_REQUIREMENTS`. That means the declared evidence requirements were not satisfied. It does not mean the proposition is false.

Regenerate from the repository root with `node examples/kar-v6/run.mjs`.
