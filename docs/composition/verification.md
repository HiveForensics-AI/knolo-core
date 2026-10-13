# Composition verification

`verifyCompositionRecord` recomputes `compositionRoot` before it walks members. A mismatch returns `COMPOSITION_ROOT_MISMATCH` and stops. `assertCompositionRoot` is the same check for attestation create and for `knolo attest verify --composition`, and it runs before member bytes are loaded. Supplied bytes are mounted or inspected with the existing V5 and V4 verifiers. A mounted image that disagrees with the record returns `COMPOSITION_DIGEST_MISMATCH`.

Missing bytes fail only when `requireMaterial` is set or `availability` is `material`. Digest mode without bytes returns success and reports each member as digest-bound.

Nested records are walked by `compositionRoot`. The same root on the ancestor stack is `COMPOSITION_CYCLE`. A chain of 8 records verifies. The 9th returns `COMPOSITION_DEPTH_EXCEEDED`. The same image `stateRoot` may appear in two nested records. The same `compositionRoot` may not appear twice on one ancestor stack. A nested record does not inherit the parent host bytes. In material mode, that child's own host image is required. Missing it is `COMPOSITION_MEMBER_MISSING` at `host`.

`verifyBoundedExcerpt` checks the excerpt root, then the parent image when bytes are supplied. `inclusion: included` without a parent is `EXCERPT_PARENT_MISSING`. A parent supplied for `inclusion: digest-bound` is `EXCERPT_INCLUSION_MISMATCH`. The check does not reveal the rest of the parent object list. The CLI passes the bundled excerpt record into that check. A declared `excerptRoot` without the excerpt file does not verify. An object id or kind that is not in the parent is `EXCERPT_NOT_INCLUDED`. A stale excerpt root is `EXCERPT_INCLUSION_MISMATCH`.

`verifyCompositionAttestation` recomputes `attestationRoot`. The signature is not an input to that root. When a signature is present, `now` is required. `now < issuedAt` or `now >= expiresAt` is `ATTESTATION_EXPIRED` even if the content root matches. `signatureRoot` is checked before Ed25519. A signature whose bytes changed without a new `signatureRoot` is `ATTESTATION_MISMATCH`. A bad Ed25519 signature whose `signatureRoot` still matches is `ATTESTATION_SIGNATURE_INVALID`. If the envelope carries `keyringRoot`, it must equal `authorityKeyringRootV1` of the supplied keyring. The selected key must satisfy `notBefore <= now`, `now < notAfter`, and `now < revokedAt`. Otherwise the result is `ATTESTATION_KEY_MISMATCH`. `checkSignature: false` checks the content root only. That mode is explicit. The CLI writes `keyringRoot` from `--keyring` when it signs, and rejects a signing key whose `keyringRoot` disagrees with that file.

`statement: used` with a `kar-result` subject reruns `evaluateKar` when the image, graph, plan, and proposition are supplied. The rerun must reproduce `karRoot`, `knowledgeRoot`, and `stateRoot`. The returned KAR certificate is the direct `evaluateKar` certificate. Composition does not add fields to it.

`queryComposedSession` runs `queryKnowledgeImageV5` on each V5 member that has an EQL string, and `query` on each V4 member that has a question. Other members are `not-queryable`. Hits stay in alias order. There is no cross-member `planRoot`. V5 query policy runs only when the caller sets `requirePolicy` and supplies the image policy.

Public vectors: [conformance/composition/v1](../../conformance/composition/v1/README.md).
