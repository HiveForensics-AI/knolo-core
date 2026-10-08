# Evidence Gate implementation plan

**Status:** TypeScript v0.1 vertical slice implemented; cross-runtime and pilot
work remain  
**Target:** Evidence Gate v0.1, then the V6 certified-evidence runtime  
**Depends on:** V5 release gates closing and the V5-to-V6 handoff being recorded

The current implementation is available as the private-to-the-release-surface
workspace package `@knolo/evidence-gate`. It validates V5 object membership and
byte spans, applies the committed read policy and applicability window, emits
claim and aggregate decisions, and verifies certificate/replay roots offline.
Rust/Python parity, the V6 KIP freeze, CLI integration, and the customer-support
pilot remain follow-on work.

## Product outcome

Evidence Gate sits between an agent and the user. It checks the material claims
in a proposed answer against a declared Knolo Knowledge Image, policy, and
point-in-time view. It returns a reproducible, independently verifiable
decision with the exact evidence used and a reason when the answer must be
revised, qualified, or blocked. A host may add its own signature after
verification.

The first product promise is:

> Before an important AI answer ships, Knolo can show which claims are supported
> by approved evidence, which are contradicted, which are conditional, and
> which are unknown.

Evidence Gate proves what Knolo checked against the declared artifact and
policy. It does not claim that a source is objectively true. Model inference,
claim extraction, user identity, UI, networking, and external actions remain
host-owned.

## Why this is the next upgrade

Knolo already has the pieces that make a gate trustworthy: portable Knowledge
Images, stable object and evidence identities, deterministic query plans,
policy roots, and verifiable receipts. The gate turns those infrastructure
pieces into a product boundary that an enterprise can place directly in an
answer path.

The feature should be demonstrated first in one narrow workflow, such as
customer-support policy answers. A focused workflow lets us measure whether the
gate catches unsupported answers without creating unacceptable false blocks.

## Scope and boundary

### In scope

- Structured answer claims supplied by a host application.
- Evidence references bound to V5 object IDs, source digests, spans, and roots.
- Applicability checks for scope, time, authority, and policy.
- Explicit handling of supporting, contradicting, conditional, and missing
  evidence.
- Deterministic decision and certificate roots.
- Independent verification against an unchanged Knowledge Image.
- CLI inspection and explanation of a gate result.
- A conformance fixture and TrustBench track for support and abstention quality.

### Out of scope for the first release

- A hosted moderation service.
- A required model provider or claim-extraction model.
- Automatic web search or uncited external evidence.
- Silent conflict resolution or last-write-wins behavior.
- A claim that Knolo establishes objective truth.
- Changes to V5 container bytes, V5 roots, V4 retrieval behavior, or existing
  receipt semantics.

## Proposed contract

The host converts an answer into a deterministic set of claim records. The
host may use a model to draft or extract them, but the gate accepts only the
validated structured form below.

```ts
type EvidenceGateClaimV1 = {
  id: string;
  text: string;
  modality: 'fact' | 'instruction' | 'condition' | 'calculation';
  evidence: Array<{
    objectId: string;
    sourceDigest: string;
    start: number;
    end: number;
    relation: 'supports' | 'contradicts' | 'qualifies';
  }>;
};

type EvidenceGateRequestV1 = {
  image: KnowledgeImageV5 | Uint8Array;
  claims: EvidenceGateClaimV1[];
  policy: {
    policyRoot: string;
    asOf?: string;
    minAuthority?: number;
    onConflict: 'contested' | 'abstain';
    requireEvidenceFor: Array<'fact' | 'instruction' | 'calculation'>;
  };
  principal: string;
};

type EvidenceGateDecisionV1 =
  'supported' | 'refuted' | 'contested' | 'conditional' | 'unknown';

type EvidenceGateResultV1 = {
  version: 'evidence-gate-v1';
  stateRoot: string;
  policyRoot: string;
  claims: Array<{
    id: string;
    decision: EvidenceGateDecisionV1;
    reasons: string[];
    evidence: string[];
  }>;
  overall: EvidenceGateDecisionV1;
  certificateRoot: string;
  replayHash: string;
};
```

The public API should be shaped around three operations:

```ts
evaluateEvidenceGateV1(request): EvidenceGateResultV1;
verifyEvidenceGateV1(result, request): void;
explainEvidenceGateV1(result): EvidenceGateExplanation;
```

The first implementation can live in a separate V6 package or branch. It must
not be exported from the V5 surface until the V6 contract is reviewed and
versioned.

## Decision rules

The evaluator runs in a fixed order so that the same request always produces
the same result:

1. Validate image roots, policy root, claim IDs, UTF-8 text, span bounds, and
   resource limits.
2. Resolve every evidence reference and verify its object ID, source digest,
   and exact byte span.
3. Apply principal, namespace, authority, time, and policy filters.
4. Build the claim evidence set while preserving contradictions.
5. Classify each claim:
   - `supported`: required evidence exists and no applicable contradiction wins;
   - `refuted`: applicable evidence contradicts the claim;
   - `contested`: applicable support and contradiction both remain;
   - `conditional`: support exists only under an explicit condition;
   - `unknown`: required evidence is absent, invalid, stale, or unauthorized.
6. Aggregate claim decisions into an overall decision using a declared policy.
   The default is fail-closed: any required `unknown`, `refuted`, or
   `contested` claim prevents an overall `supported` result.
7. Canonically encode the decision inputs and emit the certificate and replay
   roots.

No solver or language model is trusted by the verifier. If a later V6 solver
proposes candidate evidence or an obligation plan, the independent checker
must recompute membership, bounds, applicability, and the final decision.

## Delivery phases

### Phase 0 — Release closure and contract freeze

**Exit gate:** hosted V5 CI, package publication verification, and operator
sign-off are recorded as required by `V5_TO_V6_HANDOFF.md`.

- Create a separate V6 workstream from the verified V5 release point.
- Freeze the terminology, decision enum, limits, digest domains, and error
  codes in a draft KIP.
- Decide whether the first implementation is `packages/evidence-gate` or a
  V6 module outside the V5 package exports.
- Record the trust boundary and threat model.

### Phase 1 — Evidence identity and claim contract

- Add canonical serialization for claims, evidence references, policies, and
  requests.
- Add deterministic IDs and domain-separated digests for each record.
- Validate object membership, source digests, exact spans, duplicate IDs,
  malformed input, and configured size limits.
- Produce fixtures for valid, truncated, tampered, duplicate, and out-of-bounds
  references.

**Exit criteria:** a request can be serialized and independently rejected or
accepted with identical results in TypeScript and Rust.

### Phase 2 — Applicability and conflict evaluation

- Implement `asOf` and validity-window checks.
- Implement principal, namespace, authority, and policy filtering using the
  committed V5 policy root.
- Preserve competing claims and classify support, contradiction,
  qualification, and missing evidence.
- Add deterministic aggregation rules and refusal reasons.

**Exit criteria:** hand-authored fixtures cover every decision value and no
conflict is silently collapsed.

### Phase 3 — Certificate and independent verifier

- Emit a certificate containing image state root, policy root, plan root,
  claim roots, evidence membership, decision, limits, and replay hash.
- Implement verification from bytes and declared roots without trusting the
  evaluator's intermediate result.
- Add tamper tests for every certificate field and every referenced span.
- Expose `knolo v6 evidence check` and `knolo v6 evidence explain` behind the
  V6 command boundary.

**Exit criteria:** a verifier can check a result offline and detect any change
to the image, policy, claims, evidence, decision, or configuration.

### Phase 4 — Product vertical slice

- Ship a small host adapter for a customer-support policy workflow.
- Convert a draft answer into structured claims in the host application.
- Gate publication on the result; return the answer with evidence cards when
  supported and a repair/review request for other decisions.
- Store the result and certificate alongside the host's conversation/run ID.
- Add operator views for top unsupported claims, recurring conflicts, stale
  sources, and gate latency.

**Exit criteria:** a real workflow can demonstrate supported answers, blocked
answers, contested policy, stale evidence, and offline verification.

### Phase 5 — Conformance and quality gate

- Add TypeScript, Rust, and Python reader/verifier conformance where supported.
- Add a frozen benchmark with positive, negative, conflicting, conditional, and
  unanswerable questions.
- Measure claim support precision/recall, abstention precision/recall, false
  block rate, certificate verification rate, latency, and memory.
- Require replay-equivalent outputs across runtimes.
- Publish only when the quality floors and release checks pass.

## First sprint backlog

1. Create the V6 workstream and draft `KIP-0030-evidence-gate-v1.md`.
2. Define the canonical CBOR/JSON schemas and error-code table.
3. Implement request validation and evidence-span membership checks.
4. Build a minimal evaluator for the five decision values using hand-authored
   claim fixtures.
5. Implement certificate root calculation and offline verification.
6. Add one CLI inspection command and one end-to-end customer-support fixture.
7. Add cross-runtime golden vectors before adding model-assisted extraction.

The sprint deliberately starts with structured claims and deterministic
verification. Model-assisted extraction can be added behind the host adapter
after the gate itself is proven correct.

## Acceptance criteria for v0.1

- Every result names the exact Knowledge Image state root and policy root.
- Every accepted evidence span is verified against source bytes and offsets.
- Every claim receives one explicit decision and machine-readable reasons.
- Conflicts and missing evidence are visible and fail closed by policy.
- A changed image, policy, claim, span, limit, or decision invalidates the
  certificate.
- TypeScript and Rust produce identical roots for the shared fixtures.
- An offline verifier can validate a result without a model or network.
- The pilot workflow demonstrates a measurable reduction in unsupported answers
  with an agreed false-block ceiling.

## Risks and mitigations

| Risk                                    | Mitigation                                                             |
| --------------------------------------- | ---------------------------------------------------------------------- |
| Claim extraction varies by model        | Accept structured claims; bind extractor metadata in the host receipt  |
| Evidence is relevant but not sufficient | Require explicit evidence relations and claim-level decisions          |
| Conflicting sources are hidden          | Preserve both sides and return `contested` or `unknown`                |
| Fresh policy becomes stale              | Bind `asOf`, validity windows, and source digests to the certificate   |
| Gate blocks too many useful answers     | Pilot one workflow and tune policy against a frozen benchmark          |
| V6 destabilizes V5                      | Separate branch/package and preserve the V5 do-not-cross rules         |
| Teams mistake certification for truth   | Use precise product language: certified against an artifact and policy |

## Product metrics

Track these from the first pilot:

- unsupported-claim catch rate;
- supported-claim precision;
- false-block rate;
- contested and unknown rate by source and policy;
- percentage of answers with independently verifiable certificates;
- median and p95 gate latency;
- certificate size and verification time;
- number of repeated evidence conflicts resolved by a source update.

## Decision needed after the pilot

Promote Evidence Gate into the primary Knolo product surface only if the pilot
shows a meaningful reduction in unsupported answers while staying below the
agreed false-block ceiling. If it passes, expand from policy answers into
regulated workflows where an auditable evidence decision is part of the value,
not just a citation displayed after generation.
