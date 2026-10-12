# Composition verification

`verifyCompositionRecord` recomputes `compositionRoot` before it walks members. A mismatch returns `COMPOSITION_ROOT_MISMATCH` and stops. Supplied bytes are mounted or inspected with the existing V5 and V4 verifiers. A mounted image that disagrees with the record returns `COMPOSITION_DIGEST_MISMATCH`.

Missing bytes fail only when `requireMaterial` is set or `availability` is `material`. Digest mode without bytes returns success and reports each member as digest-bound.

Nested records are walked by `compositionRoot`. The same root on the ancestor stack is `COMPOSITION_CYCLE`. A chain of 8 records verifies. The 9th returns `COMPOSITION_DEPTH_EXCEEDED`. The same image `stateRoot` may appear in two nested records. The same `compositionRoot` may not appear twice on one ancestor stack.

`verifyBoundedExcerpt` checks the excerpt root, then the parent image when bytes are supplied. `inclusion: included` without a parent is `EXCERPT_PARENT_MISSING`. A parent supplied for `inclusion: digest-bound` is `EXCERPT_INCLUSION_MISMATCH`. The check does not reveal the rest of the parent object list.

`verifyCompositionAttestation` recomputes `attestationRoot`. The signature is not an input to that root. When a signature is present, `now` is required. `now < issuedAt` or `now >= expiresAt` is `ATTESTATION_EXPIRED` even if the content root matches. A bad Ed25519 signature is `ATTESTATION_SIGNATURE_INVALID`. `checkSignature: false` checks the content root only. That mode is explicit.

`statement: used` with a `kar-result` subject reruns `evaluateKar` when the image, graph, plan, and proposition are supplied. The rerun must reproduce `karRoot`, `knowledgeRoot`, and `stateRoot`. The returned KAR certificate is the direct `evaluateKar` certificate. Composition does not add fields to it.

`queryComposedSession` runs `queryKnowledgeImageV5` on each V5 member that has an EQL string, and `query` on each V4 member that has a question. Other members are `not-queryable`. Hits stay in alias order. There is no cross-member `planRoot`. V5 query policy runs only when the caller sets `requirePolicy` and supplies the image policy.

Public vectors: [conformance/composition/v1](../../conformance/composition/v1/README.md).
