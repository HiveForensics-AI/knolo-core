# KIP-0011: Authority Session V1

Status: foundation implementation

KIP-0011 defines the application-facing composition boundary for a verified
V5 authority decision. It does not add mutable transactions or a new query
language.

The session takes a knowledge image, bounded EQL expression or parsed plan,
policy, authority envelope, and evaluation time. It executes the deterministic
query, evaluates policy for the envelope subject, selects a keyring by the
envelope's optional `keyringRoot`, and verifies the signed envelope.

The keyring provider is host-supplied and may load a persisted snapshot. A
requested root that cannot be selected fails closed. The result exposes the
state, plan, query-result, authorization, envelope, and keyring roots, plus an
`authority-session` root over those values. Envelopes without `keyringRoot`
remain compatible with the earlier V5 verification path.

The initial implementation provides this facade for Ed25519/WebCrypto. Other
algorithms remain injected host adapters.
