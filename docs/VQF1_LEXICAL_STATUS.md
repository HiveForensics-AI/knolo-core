# VQF-1 lexical artifact status

The VQF lexical postings codec remains a TypeScript runtime artifact. It is
used by the local retrieval implementation and benchmark scripts, but it is
not a portable V5 representation.

The decision is based on three format gaps:

- lexical bytes do not have an authenticated required or optional V5 segment
  placement;
- Rust and Python do not have readers for lexicon pages, posting directories,
  microblocks, or phrase sections;
- profile defaults, phrase selection, query ordering, and resource limits have
  not been established as cross-runtime commitments.

The TypeScript codec remains covered by its unit and malformed-input tests.
Those tests validate the internal artifact and do not establish wire-format
compatibility. The encoder may continue to evolve without changing V5 image
roots because lexical bytes are not included in the durable V5 image contract.

If portable lexical storage is needed later, it must be a new phase with an
authenticated segment design, a versioned profile contract, Rust and Python
readers, shared fixtures, and rejection vectors before any encoder output is
advertised as interoperable.
