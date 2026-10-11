# KAR Evidence Dossier

The Evidence Dossier is the packaged evaluation. Format `kar-evidence-dossier-1`. It does not create a new semantic root and it does not change retrieval.

```ts
import { createKarDossier, renderKarDossier, verifyKarDossier, karDossierStatusStatement } from '@knolo/core/kar';

const dossier = createKarDossier({ image, graph, plan, proposition });
```

The object separates:

- `support`, `opposition`, `qualification`, `temporal`, `authority`
- `selectedEvidence`, the minimum set
- `whySelected`
- `roots`, including `knowledgeRoot`, `semanticRoot`, `queryRoot`, `planRoot`, `anchorRoot`, `frontierRoot`, `frontierWitnessRoot`, `evidenceSetRoot`, `decisionRoot`, and `karRoot`
- `certificate`, the frozen `kar-1-research-1` result
- `manifest`, the packaging record a verifier recomputes

`karDossierStatusStatement` returns:

- `Evidence requirements satisfied` when the status is `SATISFIED`
- `Evidence requirements not satisfied` when the status is `UNSATISFIED_EVIDENCE_REQUIREMENTS`

It does not say that a claim is proven or false.

`renderKarDossier` prints those sections in a stable order. The same image, CEG, proposition, and plan produce the same manifest and the same rendering. The dossier has no timestamp and no machine path.

```bash
knolo kar dossier build --image knowledge.knolo --graph knowledge.kar.json --plan plan.json --query "..." --out dossier/
knolo kar dossier verify dossier/
```

`verify` prints `VERIFIED` or a code such as `KAR_RESULT_MISMATCH`, then exits non-zero on failure. Replacing `Evidence requirements satisfied` with `Claim proven` fails closed. The CLI refuses to overwrite a dossier directory that already contains `manifest.json`.

Schema: [`kar-dossier-v1.schema.json`](../../schemas/experimental/kar/kar-dossier-v1.schema.json). The schema describes the manifest. The certificate schema is [`kar-result-v1.schema.json`](../../schemas/experimental/kar/kar-result-v1.schema.json).
