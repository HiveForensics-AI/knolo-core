# n8n KAR branch

`kar-branch.json` is an n8n workflow that runs KAR Evaluate on a pinned
image and branches with an IF node on `{{ $json.ok }}`.

`ok` is true only when the evaluation status is `SATISFIED`. That means the
evidence requirements in the plan were met. It does not mean the claim is
proven. The IF node is named Requirements met. Its true branch is Met and
its false branch is Not met. The Knolo item also includes `status` and the full
`er_` receipt.

The workflow does not call a model. Mount, pin, caller, policy, and the KAR
graph pin are node parameters. Replace the placeholder paths before running
it. An item field named `agentId` does not change the caller.

Load the node from a checkout of `n8n-nodes-knolo` with
`N8N_CUSTOM_EXTENSIONS`. npm `n8n-nodes-knolo@0.1.0` does not include KAR
yet. See [n8n](../../docs/integrations/n8n.md).
