# KIP-0003: canonical encoding and digest domains

Status: implemented foundation contract

V5 uses definite-length CBOR only. The supported foundation subset is null,
booleans, unsigned integers, negative integers, byte strings, UTF-8 text,
arrays, and maps with text keys. Indefinite-length values, floats, tags, and
duplicate map keys are rejected.

Maps are sorted by the encoded UTF-8 bytes of their text keys. Integers use
the shortest valid CBOR representation. A decoded payload must re-encode to
identical bytes before it is accepted.

Digest strings are rendered as `sha256-` followed by lowercase hexadecimal.
The digest input is:

```text
UTF8("knolo:<domain>:v1\0") || payload
```

The foundation domains are `object`, `object-root`, `event`, `event-root`,
`transaction`, `transaction-root`, `segment`, `commit`, `state`, `schema`,
`policy`, `runtime`, `view`, `receipt`, and `superblock`.

The V4 reader and retrieval contract remain unchanged. V5 migration verifies
the source artifact first, then creates a deterministic genesis image and a
receipt containing the source digest, destination state root, and legacy
block-to-object mappings.
