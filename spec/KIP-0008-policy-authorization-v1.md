# KIP-0008: Policy Authorization V1

Status: foundation implementation

KIP-0008 adds deterministic, read-only policy evaluation for V5 query results.
It is a policy filter and receipt primitive, not a signature, delegation, or
identity provider.

## Policy

```text
{
  "version": 1,
  "default": "allow" | "deny",
  "rules": [{
    "effect": "allow" | "deny",
    "action": "query" | "read",
    "principal"?: text,
    "kind"?: text
  }]
}
```

Rules are normalized and sorted before hashing. An empty rule list retains the
original V5 `{ "default": "deny" }` policy-root form for compatibility.
Otherwise the policy root is:

```text
knolo:policy:v1\0 || canonical_cbor({"default": ..., "rules": [...]})
```

The committed image `policyRoot` must equal the evaluated policy root. This
prevents a caller from evaluating a query under a policy different from the
one committed by the image.

## Evaluation

For each query hit, matching rules have the requested action and may constrain
the principal and object kind. A matching deny overrides every matching allow;
an unmatched hit uses the policy default. Results report `allow`, `partial`, or
`deny`, plus allowed and denied object IDs. Existing default-deny images remain
readable and produce denied results unless a matching policy was committed.

## Authorization root

```text
knolo:authorization:v1\0 || canonical_cbor({
  "action": text,
  "allowedObjectIds": [digest...],
  "decision": text,
  "deniedObjectIds": [digest...],
  "planRoot": digest,
  "policyRoot": digest,
  "principal": text,
  "stateRoot": digest
})
```

TypeScript and Rust must produce identical policy and authorization roots for
the same image, query result, policy, principal, and action. Signatures,
delegation, group expansion, network identity, and policy mutation remain
subsequent work.
