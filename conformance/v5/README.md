# V5 conformance fixtures

These fixtures are the byte-level compatibility set for the V5 foundation. The
contract index is [`../../spec/README.md`](../../spec/README.md), and the
implementation roadmap is [`../../docs/ROADMAP.md`](../../docs/ROADMAP.md).

The base64 fixtures are checked-in byte fixtures, not generated test output:

- `knowledge-image-v5.fixture.base64` is the minimal V5 image. Its state root is
  `sha256-bc419264f60822bb8c601f01eb3020671e78056f4e6403ab6db087911d25d694`.
- `migrated-legacy-v3.fixture.base64` is the shared V1–V3 migration image. Its
  state root is
  `sha256-e49edad45514b6ca08f2d350a094ff7750bfc7b833ac8b2ed17ddf7cafd3037c`.
- `migrated-v4-claims-agents.fixture.base64` proves claims and agent registry
  preservation. Its state root is
  `sha256-fbd098cf220b414a1dea60fe237da2bfbe4728831db6bd6f43b3c8125987d059`.
- `runtime-diagnostics-studio-v1.fixture.json` binds the shared image to the
  TypeScript and Rust KIP-0025 diagnostics root and KIP-0026 management root.

TypeScript and Rust tests load these exact bytes and compare verification or
migration output byte-for-byte, including the diagnostics and Studio snapshot
roots. The Python verifier/query profile consumes the same image and checks the
shared state, commit, plan, and result roots. The full interoperability and
trust boundary is documented in [`../../docs/V5_INTEROPERABILITY.md`](../../docs/V5_INTEROPERABILITY.md).
