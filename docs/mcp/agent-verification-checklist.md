# MCP agent integration: evidence and verification checklist

This is a review checklist for developers connecting an MCP host to Knolo's local,
verifiable knowledge workflows. It is deliberately a **verification guide**, not
an alternative protocol specification or a claim that every tool listed here is
exposed by every release of `@knolo/mcp`.

## Scope

Knolo separates the host application's responsibilities (model inference, client
transport, authorization and external side effects) from the knowledge artifact,
retrieval and verification layer.

The distinction matters when an MCP client displays a result as an "answer":
a successful tool call can demonstrate that retrieval ran against a particular
artifact, but it does **not** establish that a model's natural-language conclusion
is true.

Before implementing a client integration, consult:

- The repository's root `README.md` for the currently checked-in versions.
- `packages/mcp/` for the actual registered MCP tool names and input schemas.
- `packages/tools/` for tool behavior and output shapes.
- `docs/kar/` and `docs/cortex/` for the underlying retrieval semantics.
- The conformance fixtures under `conformance/` where applicable.

Do not assume that a feature available via `@knolo/core` is automatically
available through the MCP package.

## Five checks before showing an agent response

1. **Artifact identity.** Record the mounted artifact's expected digest or pin
   and the actual identity reported by the runtime. Compare them using the
   runtime's documented verification mechanism, not a model-generated summary.
2. **Tool contract.** Confirm the tool name, input fields and output schema from
   the version of `@knolo/mcp` actually in use. Reject or report unrecognized
   fields instead of silently inventing defaults.
3. **Retrieval outcome.** Preserve the distinction between a retrieved candidate
   set, evidence requirements being satisfied, and a statement being true.
   `SATISFIED` concerns declared KAR evidence requirements; it is *not* a truth
   certificate. `UNSATISFIED_EVIDENCE_REQUIREMENTS` does not prove a claim false.
4. **Provenance.** Keep available artifact identity, source identifiers,
   retrieval receipt identifiers and evidence references alongside the output.
   If a verification step fails, expose the failure rather than presenting a
   result as verified.
5. **Host boundary.** Treat model responses and retrieved document text as
   untrusted input. The host application retains responsibility for any
   external actions, secrets, user approvals and network access.

## Suggested integration acceptance matrix

These are test *scenarios*, not assertions that Knolo has already passed them.
Adapt each to the MCP tools, fixtures and schemas available in the checked-out
revision.

| Scenario | Action | Expected host behavior |
| --- | --- | --- |
| Known-good artifact | Mount an existing verified test image and query it | Show results with available provenance and the correct artifact identity |
| Incorrect artifact pin | Supply or expect a different digest | Surface verification failure; do not silently accept the image |
| Modified artifact bytes | Change a test copy after recording its digest | Fail verification rather than treating the changed copy as the original |
| Empty/unsatisfied evidence | Query an example that cannot meet the declared requirements | Preserve the unsatisfied/abstention state; do not turn it into a factual denial |
| Repeatability | Re-run the same deterministic retrieval over unchanged input and version | Compare evidence identities and ordering; investigate unexpected differences |
| Unknown or malformed tool input | Send an invalid request to a local test server | Report a controlled error, not a fabricated successful result |
| Unavailable optional feature | Request a tool absent from the installed MCP version | Surface unsupported functionality and identify the installed version |
| Offline execution | Disconnect the host from external services after local setup | Determine what still works locally; do not imply remote verification occurred |

When writing automated checks, bind expected outputs to checked-in fixtures.
Avoid hard-coding synthetic receipt IDs, state roots or KAR roots as if the
runtime had produced them.

## Debugging workflow

### A. The MCP tool is missing

1. Check the installed `@knolo/mcp` version against the root README and the
   local package manifest.
2. Inspect the actual tools advertised by the running MCP server.
3. Compare the requested operation with the package's registered tools; APIs
   exported by `@knolo/core/kar` or `@knolo/core/cortex` need not be registered
   as MCP tools.
4. Rebuild or reinstall the appropriate package if the checkout and running
   server differ. Restart the client so it refreshes its tool list.

**Do not** fix the issue by describing an unavailable tool to the model as
though it were implemented.

### B. A result appears successful, but provenance is absent

1. Inspect the full structured tool response rather than only the agent's
   natural-language paraphrase.
2. Determine whether that specific operation emits a receipt or an artifact
   identity at all. Do not invent a missing field.
3. If verification metadata is expected but absent, treat the result as
   **unverified** until the relevant verifier is invoked successfully.
4. Keep verification outcomes separate from summaries shown to users.

### C. Two runs appear inconsistent

1. Check whether they mounted identical artifact bytes.
2. Verify that the tool version and retrieval plan are identical.
3. Compare query options, namespace/source scope and any optional semantic
   reranking settings.
4. Confirm whether the selected operation is documented as deterministic.
5. Attach redacted requests and raw responses to the report; do not conclude
   a cryptographic contract is broken before isolating those variables.

### D. An agent presents insufficient evidence as certainty

Use language that reflects the tool's actual status. For example:

- **Supported evidence:** "The declared evidence requirements were satisfied
  for the supplied plan; review the cited evidence before accepting the claim."
- **Insufficient evidence:** "The available evidence does not satisfy the
  declared requirements; no conclusion about the claim's truth follows."
- **Verification failure:** "The artifact or result could not be verified.
  Treat it as unverified until the integrity check succeeds."

The host should not translate these outcomes into an unqualified "true" or
"false" answer.

## Reviewer checklist for a pull request

- [ ] Target MCP package version and runtime version are recorded.
- [ ] Tool names and example requests match the **current implementation**.
- [ ] Documentation distinguishes artifact integrity from semantic truth.
- [ ] Example output clearly labels illustrative values as placeholders.
- [ ] Negative tests cover a wrong pin, altered bytes and insufficient evidence.
- [ ] No secrets, tokens or private documents appear in examples or logs.
- [ ] Relevant package tests and `npm run release:check` are run where the
      checkout and dependencies permit; failures are reported accurately.
- [ ] Any modified byte format, root contract or required section is backed by
      specification updates and cross-runtime fixtures.

## Why this checklist exists

An MCP host often collapses several stages—tool execution, artifact integrity,
retrieval, evidence satisfaction and model summarization—into one chat message.
Those stages have different trust guarantees.

Keeping them separate helps maintainers debug integrations, gives downstream
agent developers an actionable review procedure, and reduces the risk of
presenting an apparently successful retrieval as a proof of correctness.
