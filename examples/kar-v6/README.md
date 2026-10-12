# KAR V6 examples

These three examples are hand-authored and redistributable. They are product demos on the 6.1.0 tree. They are not a claim that a Domain Pack extracts every contract, policy, or procedure. Composition can cite the resulting images and graphs. It does not change `KARRoot`.

```bash
npm run build --workspace @knolo/core
node examples/kar-v6/run.mjs
```

From a checkout you can also run `knolo kar demo`.

| Directory | What it shows |
| --- | --- |
| `contracts/` | Support and opposition both stay in the selected evidence |
| `policy/` | A general requirement and an exception both stay |
| `operations/` | A satisfied procedure, plus `operations/gap/` where evidence requirements are not satisfied |

`UNSATISFIED_EVIDENCE_REQUIREMENTS` means the declared requirements were not met inside the committed Knowledge Image, Committed Evidence Graph, and plan. It does not mean the proposition is false.

Each satisfied case writes a Knowledge Image, CEG Source, compiled sidecar, plan, query, and a verified Evidence Dossier.
