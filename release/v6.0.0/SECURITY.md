# Security re-check

Reviewed after the version bump to `6.0.0`. The diff from release candidate `39dd07e4` to package commit `172fcf79` does not modify KAR runtime, CEG compiler, producer, CLI limit, or manifest code. Documentation added with this directory does not change those guards either.

| Control | State |
| --- | --- |
| Reserved object keys | Still rejected before assignment. JSON and YAML reserved keys still fail as `CEG_PARSE` |
| Path traversal | CLI paths resolve as ordinary local paths. No archive extractor was added |
| Archive handling | No new archive reader |
| Manifest validation | Unknown distribution fields still fail as `CEG_MANIFEST_MISMATCH` |
| Unknown fields | Still fail closed |
| Source size caps | `CEG_LIMITS.maxSourceBytes` remains 32 MiB. CLI text cap remains 32 MiB and image cap remains 512 MiB |
| Regex safety | `regexIsSafe` still rejects backreferences, lookaround, and nested quantifiers. The suite still rejects `(a+)+`, `(.*)+`, `(?=a)`, `(?!a)`, and `\1` |
| Graph, cover, and closure bounds | Unchanged. `maxCoverVisits` 0 is `SEARCH_BOUND_EXCEEDED`. Closure over the node bound is `CLOSURE_BOUND_EXCEEDED`. No approximate fallback |
| Proposal limits | Rule match cap and text length refusal remain |

`npm audit` on the workspace reported 0 info, low, moderate, high, and critical findings. Classification: no unresolved advisory. No dependency was upgraded for GA.

Dossier verification on the packed `6.0.0` tarball rejected tampered `karRoot`, selected evidence, the status sentence, the plan, and the graph.
