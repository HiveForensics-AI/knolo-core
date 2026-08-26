# KIP-0015: Divergent Merge Planning V1

Status: foundation implementation

KIP-0015 defines the read-only boundary for divergent V5 branches. Given two
verified direct child images and their shared verified ancestor, the runtime
returns a deterministic merge plan. The plan lists branch-only object and
event identities and conflicts for competing event targets, view roots, and
commit metadata roots.

Merge planning requires matching authority keyring roots and rejects missing,
unrelated, non-divergent, or malformed ancestors. The plan is content-addressed
with the `knolo:merge-plan:v1` SHA-256 domain. `verifyKnowledgeMergePlanV5`
recomputes all summary and plan roots before accepting an external plan.

KIP-0015 does not select a winner, rewrite an object, apply a merge commit, or
mutate either branch. Conflict resolution policy, merge authorization, and
atomic merge application remain subsequent upgrades.
