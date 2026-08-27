# KIP-0000 — Specification process

**Status:** Draft  
**Created:** 2026-08-27

## 1. Purpose

A Knolo Improvement Proposal (KIP) is the only place a V5 wire-level
behavior may be defined. Implementation code may realize a KIP. It may
not invent one.

## 2. Lifecycle

| State | Meaning |
|-------|---------|
| Draft | Open for review. Implementations may prototype behind a feature flag. |
| Accepted | Frozen for an implementation milestone. Breaking changes require a new KIP revision. |
| Final | Shipped in a tagged runtime. Changes are additive or a new major. |
| Deprecated | Still parsed; no new writes. |
| Rejected | Must not ship. |

## 3. Required sections

Every KIP MUST include: motivation, normative rules, data types,
invariants, compatibility, threat notes, and conformance vectors.

Language:

- MUST / MUST NOT / SHOULD / MAY follow RFC 2119.
- "Normative" sections are binding on all bindings.
- Examples are informative unless marked `// normative example`.

## 4. Versioning

- Container magic + `formatMajor` identify the on-disk family.
- `runtimeContract` digest pins operator, tokenizer, scoring, and policy
  semantics independently of `formatMajor`.
- A change that alters any committed digest is a breaking change.

## 5. Identity algorithm

SHA-256 is mandatory for V5. Algorithm agility is expressed as an
explicit `alg` field. FNV and other non-cryptographic hashes MUST NOT
be used for object IDs, event IDs, plan hashes, receipts, capabilities,
or state roots.

## 6. Encoding

Unless a KIP specifies raw bytes, structures are encoded as deterministic
CBOR per KIP-0003 (RFC 8949 + RFC 8949 §4.2.1 core deterministic
encoding, plus Knolo key-order rules).

## 7. Reviewers

Minimum review set before Accepted: runtime engineer, security reviewer,
one binding owner (Node or Python).
