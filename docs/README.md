# Knolo documentation

This directory contains the public implementation direction, release, and
operational guides for Knolo.

## Start here

- [V5 roadmap](ROADMAP.md) — delivered foundation, release hardening, and the
  next implementation waves.
- [Release guide](RELEASE.md) — preflight checks and publication commands for
  npm and crates.io, plus legacy runtime boundaries.
- [V5 host deployment boundary](V5_HOST_DEPLOYMENT.md) — adapter ownership,
  deployment sequence, retry behavior, and monitoring boundaries.
- [V5 coordination boundary](V5_COORDINATION.md) — durable writer leases,
  stale recovery, authorization gates, and production sync application.
- [V5 interoperability boundary](V5_INTEROPERABILITY.md) — frozen vectors,
  receipt/root rules, runtime compatibility, and trust limits.
- [V5 specification index](../spec/README.md) — KIP byte, root, runtime, and
  management contracts.
- [V5 conformance fixtures](../conformance/v5/README.md) — shared binary
  fixtures consumed by TypeScript and Rust.
- [V4 conformance fixtures](../conformance/README.md) — retrieval and TrustBench
  compatibility baseline.
- [VQF-1 benchmarks](VQF1_BENCHMARKS.md) — reproducible ordinary and opt-in
  physical-compression measurements.
- [VQF-1 implementation status](VQF1_IMPLEMENTATION.md) — internal codecs,
  source spans, VQF envelope semantics, limits, and validation commands.
- [VQF-1 format freeze boundary](VQF1_FORMAT_FREEZE.md) — portable
  object/event envelope rules and the TypeScript-only encoder boundary.
- [VQF-1 lexical status](VQF1_LEXICAL_STATUS.md) — why lexical postings remain
  a TypeScript runtime artifact.
- [VQF-1 next phases](VQF1_NEXT_PHASES.md) — decoder parity, hardening, and
  release handoff.
- [Reflex 0.2 empirical intelligence plan](REFLEX_0.2_PLAN.md) — provenance,
  clustering, capability calibration, MRS frontiers, and benchmark gates.
- [Evidence Gate implementation plan](EVIDENCE_GATE_IMPLEMENTATION_PLAN.md) —
  claim-level evidence decisions, certificates, verification, and the first
  product pilot.
- [Knolo for OpenClaw implementation plan](OPENCLAW_IMPLEMENTATION_PLAN.md) —
  read-only V5 plugin scope, tool and audit contracts, delivery phases, and
  later grounding and memory modes.
- [`@knolo/openclaw`](../packages/openclaw/README.md) — local V5 mounts,
  policy-aware retrieval, query records, and the native OpenClaw tool plugin.
- [`@knolo/mcp`](../packages/mcp/README.md) — the same read-only V5 tools over
  MCP stdio. A mount can pin a KAR graph and add read-only evaluation,
  verification, and Cortex trace checks. Pins, policy checks, and receipts
  come from [`@knolo/tools`](../packages/knolo-tools/README.md). Caller
  identity comes from the server config.
- [`@knolo/ai-sdk`](../packages/ai-sdk/README.md) — Vercel AI SDK tools over
  [`@knolo/tools`](../packages/knolo-tools/README.md). Knolo does not call a
  model. A search returns a query receipt. `SATISFIED` means evidence
  requirements were met. `@knolo/ai-sdk@0.1.0` is published.
- [Knolo Verify action](../.github/actions/knolo-verify/README.md) — composite
  GitHub Action that runs a pinned `@knolo/cli` over committed packs, images,
  KAR artifacts, attestations, and Cortex traces. It does not add verification
  rules.
- [`@knolo/evidence-gate`](../packages/evidence-gate/README.md) — the current
  TypeScript vertical slice for deterministic claim-level verification.
- [KAR](kar/README.md) — minimum evidence-set retrieval over a Committed
  Evidence Graph. Import it from `@knolo/core/kar`. The root `@knolo/core`
  entry does not load it.
- [Composition](composition/README.md) — offline citations and attestations.
  Import it from `@knolo/core/composition`. It does not change KAR or V5 roots.
- [Cortex](cortex/README.md) — bounded evidence retrieval and a verifiable
  trace. Import it from `@knolo/core/cortex`. This is not the root memory
  helper `createCortex`. Verification does not mean an answer is true.
- [Flight logs](flight/README.md) — offline packing of a `flight-events-1`
  document into a V5 Knowledge Image. A pass means evidence requirements
  were met. It does not mean a flight was safe or compliant.
- [Skills](skills/README.md) — `knolo skill` creates a skill pack for the
  host agent. These commands are part of Knolo. A receipt is an integrity
  check. It does not mean a claim is proven. `publish` and `install` use
  `https://hub.knolo.dev`. `--hub` is a local directory for an offline
  catalog. The hub stores packs and does not answer questions. Box stays
  separate.
- [Community hub and one install path](hub/COMMUNITY.md) — how the CLI,
  Box, MCP, and hub.knolo.dev fit one setup. `knolo setup` prepares a
  local index when Box is available and prints the hub next steps.
- [Code image](code/README.md) — local V4 pack of a workspace and the Grok
  Build plugin that retrieves structure before full chunks. The published
  `@knolo/code` check is recorded on that page. npm `latest` is `0.1.1`.
- [Google ADK](integrations/google-adk.md) — Python and TypeScript agents
  that call published `@knolo/mcp@0.2.3` over stdio. A search returns a query
  receipt. Verification checks the image. `SATISFIED` means evidence
  requirements were met.
- [OpenAI Agents SDK](integrations/openai-agents.md) — a TypeScript smoke
  that calls published `@knolo/mcp@0.2.3` over stdio, and native
  `@knolo/openai-agents` tools. Knolo does not call a model. A search returns
  a query receipt. `SATISFIED` means evidence requirements were met.
  `@knolo/openai-agents@0.1.0` is not published yet.
- [Anthropic Agent Skill](integrations/anthropic-skills.md) — a Claude Code
  plugin that loads a Knolo skill and registers `@knolo/mcp@0.2.3` over
  stdio. The skill answers through the mounted tools and cites `imageId`,
  `objectId`, and `stateRoot`. A receipt is an integrity check. `SATISFIED`
  means evidence requirements were met. The upstream skills listing is
  separate.
- [Pydantic AI](integrations/pydantic-ai.md) — a Python smoke that calls
  published `@knolo/mcp@0.2.3` over stdio. Knolo does not call a model. A
  search returns a query receipt. `SATISFIED` means evidence requirements
  were met.
- [Agno](integrations/agno.md) — a Python smoke that calls published
  `@knolo/mcp@0.2.3` over stdio through Agno `MCPTools`. Knolo does not call
  a model. A search returns a query receipt. `SATISFIED` means evidence
  requirements were met.
- [CrewAI](integrations/crewai.md) — a Python smoke that calls published
  `@knolo/mcp@0.2.3` over stdio through CrewAI `MCPServerAdapter`. Knolo does
  not call a model. A search returns a query receipt. `SATISFIED` means
  evidence requirements were met.
- [Haystack](integrations/haystack.md) — a Python smoke that calls published
  `@knolo/mcp@0.2.3` over stdio through Haystack `MCPToolset`. Knolo does not
  call a model. A search returns a query receipt. `SATISFIED` means evidence
  requirements were met.
- [smolagents](integrations/smolagents.md) — a Python smoke that calls
  published `@knolo/mcp@0.2.3` over stdio through `ToolCollection.from_mcp`.
  Knolo does not call a model. A search returns a query receipt. `SATISFIED`
  means evidence requirements were met.
- [Langflow](integrations/langflow.md) — a Python smoke that calls published
  `@knolo/mcp@0.2.3` over stdio. Knolo does not call a model. A search
  returns a query receipt. `SATISFIED` means evidence requirements were met.
- [Dify](integrations/dify.md) — Dify 1.19.0 registers an MCP server by
  an http or https URL. A Python smoke calls published `@knolo/mcp@0.2.3`
  over stdio. Knolo does not call a model. A search returns a query
  receipt. `SATISFIED` means evidence requirements were met.
- [Docker](integrations/docker.md) — a stdio image of `@knolo/mcp` built
  from this repository. It does not listen on a port. A bad pin exits before
  the server accepts a tool call. An unwritable audit directory returns no
  hits. The image is not on Docker Hub. The catalog pull request is separate.
- [Goose](integrations/goose.md) — a stdio extension draft for Goose. The
  server does not listen on a port. `@knolo/mcp@0.2.3` is the published
  command Goose launches. The directory pull request is separate.
- [Vercel AI SDK](integrations/ai-sdk.md) — `@knolo/ai-sdk` tools over
  `@knolo/tools`. Knolo does not call a model. A search returns a query
  receipt. `SATISFIED` means evidence requirements were met.
  `@knolo/ai-sdk@0.1.0` is published.
- [Mastra](integrations/mastra.md) — `@knolo/mastra` tools over
  `@knolo/tools`. Knolo does not call a model. A search returns a query
  receipt. `SATISFIED` means evidence requirements were met.
  `@knolo/mastra@0.1.0` is not published yet.
- [n8n](integrations/n8n.md) — `n8n-nodes-knolo` search, get, and verify
  for a pinned Knowledge Image. Knolo does not call a model. A search
  returns a query receipt. A receipt is an integrity check. `SATISFIED`
  is not a search result. `n8n-nodes-knolo@0.1.0` is not on npm yet.
- [Box](box/README.md) — pinned V5 images of skills, opted-in notes, private
  memory, and capped session text on a Grok Bot computer. `@knolo/box` starts
  the existing read-only MCP server in one process. npm `latest` is `0.1.1`.
  This tree is `0.1.1`.

Architecture sources, future-version specifications, and internal planning
records are kept local and are not part of the public repository. The
normative implementation contracts are the KIPs under `../spec/`.

## Current release boundary

The current product line in this repository is Knolo 6.2.0. V6 adds KAR on
the V5 Knowledge Image: deterministic images, verification, migration,
bounded runtime features, diagnostics, and a read-only Studio management
snapshot remain. 6.1.0 adds offline composition and attestation. 6.2.0 adds
Knolo Cortex. Published `@knolo/core` is `6.2.1`. `@knolo/tools` `0.2.1`
depends on `@knolo/core` `^6.2.1`. This tree's `@knolo/mcp` is `0.2.3`.
npm `latest` for MCP is `0.2.3`. This tree's
`@knolo/cli` package file is `6.2.3` and depends on `@knolo/core` `^6.2.0`.
npm `latest` for the CLI is `6.2.3`. `@knolo/langchain`, `@knolo/llamaindex`,
`@knolo/semantic-ollama`, `create-knolo-app`, and `@knolo/reflex` stay on
`@knolo/core` `^6.0.0`. `@knolo/ai-sdk@0.1.0` stays on `@knolo/core` `^6.2.0`
and `@knolo/tools` `^0.2.0`. `@knolo/mastra` `0.1.0` is not published yet and
depends on `@knolo/core` `^6.2.1` and `@knolo/tools` `^0.2.1`.
`@knolo/openai-agents` `0.1.0` is not published yet and depends on
`@knolo/core` `^6.2.1` and `@knolo/tools` `^0.2.1`. V4 retrieval
APIs remain compatible. Rust, Python,
and ICP stay 5.5.1 and do not implement KAR, composition, or Cortex.
Bundled Domain Packs are `review-required`. Networking,
credentials, model execution, external side effects, and UI presentation
remain host responsibilities.
