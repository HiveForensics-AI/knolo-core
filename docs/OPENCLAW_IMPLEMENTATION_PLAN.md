# Knolo for OpenClaw implementation plan

**Status:** initial local-first implementation complete; OpenClaw host validation pending Node 24.16+
**Prepared:** 2026-10-09
**First release:** read-only native OpenClaw plugin for verified V5 Knowledge Images

## Outcome and release boundary

Build `@knolo/openclaw` so an OpenClaw agent can search operator-approved Knowledge Images, retrieve exact objects, and report the verified image and query roots used for each result. The plugin runs against local bytes and requires no Knolo cloud service during an agent turn. Knolo owns image validation and deterministic query results; OpenClaw owns the agent, model, channels, tool policy, and actions.

The first release has four agent tools (`knolo_search`, `knolo_get`, `knolo_verify`, `knolo_status`), a bundled grounding skill, local V5 mounts, an operator path for preinstalled Hub images, and a durable query audit record. It does not replace OpenClaw Memory or claim to certify the model's final answer. Automatic prompt grounding, a memory provider, and answer gating follow after the tool integration proves stable.

This is an external plugin in `packages/openclaw/`; no OpenClaw core fork or change to the V5 image format is required. OpenClaw's [native plugin guide](https://docs.openclaw.ai/plugins/building-plugins) and [SDK overview](https://docs.openclaw.ai/plugins/sdk-overview) describe the supported extension path and mark plugin APIs experimental. Pin and test every declared host version.

## Current foundation and gaps

| Area               | Existing implementation                                                                                                                                                                     | Work needed for this integration                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V5 image integrity | `@knolo/core` exports `mountKnowledgeImageV5`, `openKnowledgeImageV5`, and `verifyKnowledgeImageV5`. Invalid bytes throw; a successful verification returns `stateRoot` and `commitDigest`. | Load bounded local bytes and compare the operator's expected byte digest and state root before exposing any content.                                                                                                       |
| V5 retrieval       | `queryKnowledgeImageV5` returns ordered object IDs with `stateRoot`, `planRoot`, and `resultRoot`; `verifyKnowledgeQueryResultV5` recomputes them.                                          | Wrap `FROM chunk SEARCH "…" LIMIT n`, map IDs to bounded UTF-8 excerpts, and retain the complete result for replay. V5 EQL does **not** return relevance scores or use the V4 BM25 ranking API.                            |
| Read policy        | `evaluateKnowledgeQueryPolicyV5` checks a supplied policy against the image's committed `policyRoot`. The image carries the root, not necessarily the policy document.                      | Require an operator-supplied matching policy for protected mounts, bind the OpenClaw agent to a Knolo principal, and apply `query` and `read` decisions before returning bytes. Missing or mismatched policy fails closed. |
| V4 receipts        | `queryWithReceipt` and `verifyReceipt` operate on V4 `Pack`, not V5 images.                                                                                                                 | Define a plugin audit envelope around the existing V5 query result. Do not label it a V4 `QueryReceipt` or invent an answer certificate.                                                                                   |
| Hub installation   | `@knolo/cli` already downloads, hashes, verifies V4/V5 artifacts, caches by SHA-256, and records version/digest/root in `knolo.lock.json`.                                                  | Reuse a preinstalled, locked V5 artifact as a local mount. Direct `publisher/name@sha256:…` resolution and `openclaw knolo add` are follow-on operator UX.                                                                 |

Relevant local contracts: [`@knolo/core` exports](../packages/core/src/index.ts), [V5 query](../packages/core/src/knowledge_query_v5.ts), [V5 policy](../packages/core/src/knowledge_policy_v5.ts), [Hub installer](../packages/cli/bin/registry/commands.mjs), and [V5 trust boundary](V5_INTEROPERABILITY.md).

## Proposed package and ownership

```text
packages/openclaw/
  package.json                  npm package and OpenClaw compatibility metadata
  openclaw.plugin.json          static identity, config schema, tools, skill, CLI
  src/index.ts                  native plugin entry and registration
  src/mounts.ts                 configured mount loading and immutable snapshots
  src/search.ts                 V5 query, policy filtering, excerpt projection
  src/receipts.ts               local audit envelope and replay verification
  src/tools.ts                  four agent tools and bounded result schemas
  src/cli.ts                    operator commands, if supported in pinned SDK
  skills/knolo-grounding/SKILL.md
  test/                         fixtures and host integration tests
```

Use `definePluginEntry` from `openclaw/plugin-sdk/plugin-entry` and `api.registerTool` for this mixed tool, skill, and eventual CLI package. Ship a native `openclaw.plugin.json`, compiled ESM entry, and all runtime imports in production dependencies. Keep the dependency on `@knolo/core` explicit. The manifest's `skills` path loads the bundled `SKILL.md`; the skill explains when to query, how to cite `imageId` plus `objectId`, and when to say the mounted evidence is insufficient. A skill is guidance, not authorization. These seams are documented in OpenClaw's [plugin manifest](https://docs.openclaw.ai/plugins/manifest), [tool registration](https://docs.openclaw.ai/plugins/sdk-overview/tools-and-commands), and [skills](https://docs.openclaw.ai/skills) references.

The plugin maintains an immutable **mount snapshot** per configured image: image ID, allowed agents, local source path, expected SHA-256, expected state root, verified bytes or reader, matching policy, and generation ID. Each operation holds one snapshot until it finishes. Reload builds and verifies a new snapshot before atomically replacing the old one; an in-flight query finishes against its original snapshot. `knolo_get` requires the state root returned by search and rejects a changed mount. No model tool accepts a path, URL, registry spec, or mount mutation.

## Configuration and trust rules

The following is the proposed plugin-owned schema, subject to validation against the pinned OpenClaw SDK during Phase 1. Values under `plugins.entries.knolo.config` are operator configuration, not agent arguments.

```json
{
  "mounts": [
    {
      "id": "support-policy",
      "path": "/srv/knolo/support-policy.v5",
      "sha256": "<64 lowercase hex characters>",
      "stateRoot": "sha256-<64 lowercase hex characters>",
      "policyPath": "/srv/knolo/support-policy.policy.json",
      "agents": ["support-agent"],
      "principal": "openclaw:support-agent"
    }
  ],
  "maxImageBytes": 262144000,
  "maxHits": 8,
  "maxExcerptBytes": 1600,
  "auditDir": "/srv/knolo/audit"
}
```

Use a canonical path resolved at setup time, reject duplicate image IDs and unexpected file types, and verify the exact bytes before mount. An expected SHA-256 prevents silent substitution of a local file; the V5 state root identifies committed logical state. For Hub installs, read the existing `knolo.lock.json` entry and cached bytes at operator setup, then copy the resolved digest and state root into the mount record. Do not let a mutable `latest` label define an active mount. Offline starts must work from cached bytes.

The committed Knolo policy root must equal `knowledgePolicyRootV5(policy)` before any query. `query` authorization filters returned hits; `read` authorization is checked again in `knolo_get`. The OpenClaw agent ID is mapped from trusted tool context or explicit operator configuration, never from model-supplied text. Missing agent identity, unauthorized mount, malformed policy, stale bytes, failed verification, or audit write failure returns a clear error and no evidence text. Do not turn a denial into an empty successful search.

Image integrity does not establish source truth or grant file access. Treat retrieved text as untrusted data and quote it as evidence, never as an instruction. The plugin does not read arbitrary local paths, execute content, fetch remote URLs during turns, or expose full private policy or filesystem paths in agent tool output. OpenClaw's own tool allowlists and plugin capability review remain active; a Knolo mount grants access only to its approved image.

## Agent tool contract

All inputs are bounded by the plugin configuration and validated before calling core. Output schemas are versioned in the plugin. Errors use stable codes such as `IMAGE_UNAVAILABLE`, `IMAGE_INVALID`, `ACCESS_DENIED`, `QUERY_INVALID`, and `AUDIT_UNAVAILABLE`.

| Tool           | Input                                                                            | Successful output                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `knolo_search` | `query`, optional approved `imageIds`, `limit`                                   | Ordered hits with `imageId`, `objectId`, `kind`, bounded excerpt, `stateRoot`, `planRoot`, `resultRoot`, and plugin `receiptId`. No synthetic score.                     |
| `knolo_get`    | `imageId`, `objectId`, required `stateRoot`, optional byte-bounded excerpt range | Exact authorized object content or excerpt, object ID, byte range, and snapshot root. Rejects an ID outside the active image or a changed root.                          |
| `knolo_verify` | Optional approved `imageId`                                                      | Recomputed byte digest and V5 verification result for the selected active mount(s), compared with configured pins. This proves artifact integrity, not factual accuracy. |
| `knolo_status` | No input                                                                         | The caller's visible mount IDs, state roots, source type, and healthy/degraded status; no absolute paths, secrets, or inaccessible mounts.                               |

Search builds a V5 EQL expression with properly escaped query text, fixed `FROM chunk`, and a configured `LIMIT` no greater than core's 1000-hit ceiling. Normalize and cap query length; do not pass arbitrary EQL from the model. Search each authorized mount separately, then order multi-image results by configured mount order and each image's deterministic result order. Preserve each image's roots rather than fabricating a single aggregate Knolo root. Map a hit through the verified reader, require a valid UTF-8 chunk, and truncate on UTF-8 boundaries. For `knolo_get`, issue an exact-object V5 query and apply the `read` policy to that result before returning bytes. If the corpus needs ranking or broader recall, measure the V5 EQL behavior first and design a separate versioned retrieval profile; do not imply V4 lexical ranking is already available on V5 images.

## Query audit record

The plugin stores one local `openclaw-knolo-query-v1` record per searched image, including empty results. A record contains: plugin/host version, configured image ID, byte SHA-256, V5 state root, normalized query, full `KnowledgeQueryResultV1`, authorization decision/root, returned object IDs and byte ranges, caller agent ID, run/session correlation when the host provides it, and creation time. Compute a plugin record digest over a documented canonical encoding and assign a local `receiptId`; store records in a bounded operator-owned directory with restricted access. A multi-image response carries each image's receipt ID beside its hits. The agent sees only `receiptId`, evidence IDs, and relevant roots.

Replay verification loads the pinned image bytes, checks SHA-256 and V5 root, calls `verifyKnowledgeQueryResultV5`, recomputes policy authorization and returned excerpt ranges, and validates the plugin record digest. Timestamp and OpenClaw run ID are audit metadata, not part of Knolo's deterministic query root. The record proves which verified bytes the plugin queried and returned. It cannot prove the model read the result, used it in reasoning, or based a later external action on it. Those claims require host-side answer/action binding in a later phase.

## Delivery phases and exit gates

### Phase 0: contract spike

- Pin one OpenClaw stable release and its matching plugin SDK; check the exact manifest, tool context, CLI registration, skill loading, and compatibility metadata against that release. Record the first supported host version and Node requirement.
- Run a small V5 fixture through `verifyKnowledgeImageV5`, `queryKnowledgeImageV5`, `verifyKnowledgeQueryResultV5`, and `evaluateKnowledgeQueryPolicyV5`; record output and latency. Confirm that the fixture contains a policy whose document is available and matches its committed root.
- Decide the initial maximum image size and reload strategy from measured memory use. `queryKnowledgeImageV5` currently remounts the input; cache only verified state and profile repeated queries before changing core.

**Exit:** a checked-in compatibility note and fixture demonstrate the exact core and OpenClaw surfaces used by the plugin.

### Phase 1: package, mounts, and four tools

- Add `packages/openclaw` as a workspace with compiled ESM, native manifest, strict config schema, and `@knolo/core` dependency.
- Implement pinned local mounts, agent allowlists, matching policy loading, atomic reload, and tool outputs. Enforce query, result, excerpt, and file size limits before exposing bytes.
- Register four tools through the public SDK. Keep the tool schema and manifest tool metadata in sync. Add the bundled grounding skill and verify it loads only when the plugin is enabled.
- Add fixture tests for valid, tampered, replaced, truncated, unauthorized, missing-policy, and empty-result images. Exercise two agents with disjoint mounts.

**Exit:** an agent can search and get only approved V5 chunks; every returned hit carries verified V5 roots; failure cases expose no content.

### Phase 2: audit and operator workflow

- Add the local query audit record, bounded retention, replay verifier, and `receiptId` lookup for operators. Prove record tampering and changed image bytes fail replay.
- Provide operator commands for add/verify/list/remove mounts if the pinned SDK supports the intended root command shape. Do not publish the illustrative `openclaw knolo add` syntax until its host integration is tested. A config-file workflow is acceptable for the first release.
- Document Hub preinstallation using `knolo add publisher/slug@version`, the generated digest lock, and a local V5 mount. Require V5 format and the locked digest/root. Keep Hub HTTP outside agent tools and startup when the cache is complete.

**Exit:** a fresh installation works offline with a local image; a preinstalled Hub V5 image mounts from pinned local bytes; an operator can replay a search record after restart.

### Phase 3: packaging and distribution

- Test build, unit and integration fixtures, `npm pack`, OpenClaw's plugin validation, and a packed install with `npm-pack:`. Inspect runtime registration with `openclaw plugins inspect knolo --runtime --json` and run a real agent turn. A source checkout alone does not validate production dependencies.
- Run the matrix against the current supported OpenClaw stable release and beta in CI. Declare compatibility only for tested versions and rerun the matrix on each OpenClaw or `@knolo/core` upgrade.
- Publish `@knolo/openclaw` to npm and submit the package to ClawHub after its package identity, version, capabilities, source, and installation route are confirmed. Test the actual ClawHub install path before documenting a literal `clawhub:` locator. The [OpenClaw publishing guide](https://docs.openclaw.ai/plugins/building-plugins) uses the separate `clawhub` CLI.

**Exit:** a user can install a published, pinned package; configure one V5 mount; ask a grounded question; and replay its query record with no Knolo network service.

## Later capabilities and dependencies

1. **Direct Hub mounts.** Add a host-owned fetch/update command using Hub's version manifest, SHA-256, V5 root, and content-addressed cache. Introduce a digest locator only after the Hub CLI/API accepts and tests it. No model-selected URL or implicit update.
2. **Automatic grounding.** Opt in to `before_prompt_build` after OpenClaw's conversation and prompt permissions are understood. Use the authorized post-policy hook phase where retrieval depends on the same turn's tool permission. Bound context size, preserve evidence IDs, and handle host hook absence explicitly. See [prompt hook contract](https://docs.openclaw.ai/plugins/hooks/prompt-and-session).
3. **Knolo Memory Mode.** Add an optional `registerMemoryCapability` provider with caller-bound search, get, health, and declared capabilities. Selecting this exclusive memory slot changes OpenClaw's active memory provider, so keep it a separate opt-in mode with coexistence and rollback tests. See [memory slot contract](https://docs.openclaw.ai/plugins/sdk-overview/memory-and-context).
4. **Verified Answer Mode.** Bind the final answer and evidence set to a host run record, then evaluate claims with `@knolo/evidence-gate` where supported. `before_agent_finalize` may request a bounded revision on supported harnesses, but it does not run on every harness and a revision request is not a universal hard block. Define a separate enforcement path before claiming that answers or actions are gated. See [finalization hook limits](https://docs.openclaw.ai/plugins/hooks/prompt-and-session) and the [Evidence Gate plan](EVIDENCE_GATE_IMPLEMENTATION_PLAN.md).

## Release acceptance checklist

- The plugin uses public OpenClaw SDK imports only; its manifest and packed artifact validate on every claimed host version.
- V5 images are verified against configured byte digests and state roots before any content is returned. Changing bytes, policy, or roots fails closed.
- Search/get enforce per-agent visibility and both `query` and `read` policy decisions. Model input cannot name a path or cause a network fetch.
- Results expose stable object IDs and V5 query roots without fabricated scores or answer-certification claims.
- A stored search record replays offline against the same image and rejects tampering.
- Local and preinstalled Hub V5 mounts work without Knolo credentials or network access during turns.
- The package passes unit, adversarial, packed-install, and live OpenClaw tool tests; the stable/beta CI matrix records compatibility and a rollback path.
