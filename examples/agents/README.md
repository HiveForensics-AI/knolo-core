# agents

Example agent definitions for Knolo. Each YAML file declares a reusable
agent config that a host application loads when mounting a Knowledge Image.

A definition sets the system prompt, retrieval defaults, and tool policy.
It does not call a model or start a server.

## mobile-support.yaml

A mobile support agent scoped to the `mobile` namespace. Retrieves the top
5 results from a pinned Knowledge Image and restricts tool access to
`search_docs`.

```yaml
id: mobile.support
version: 1
name: Mobile Support Agent
systemPrompt:
  format: markdown
  template: |
    You are {{team}} support.
    Answer with practical, deterministic troubleshooting steps.
retrievalDefaults:
  namespace:
    - mobile
  topK: 5
toolPolicy:
  mode: allow
  tools:
    - search_docs
```

`{{team}}` is a template variable replaced by the host at runtime.

## Usage

Load the YAML in your host application and pass it to the agent runtime
alongside a mounted Knowledge Image. Retrieval uses the namespace and topK
from the file. The tool policy controls which tools the agent can call.

These are starting points. Adapt the system prompt, namespaces, and tool
policy for your own knowledge base.

## Related

- [Durable agent runs](../../docs/ROADMAP.md) in the V5 roadmap
- [`@knolo/core`](../../packages/core/README.md) for the retrieval engine
- [`@knolo/mcp`](../../packages/mcp/README.md) for the MCP server

---

## License

Apache-2.0
