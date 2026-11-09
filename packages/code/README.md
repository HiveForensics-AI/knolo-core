# @knolo/code

Local V4 code Knowledge Image for Grok Build. The host owns the model. Retrieval is lexical. There is no embedding call.

## Install in Grok Build

Node.js 20 or newer must be on `PATH`.

```bash
grok plugin install HiveForensics-AI/knolo-core#plugins/knolo-code --trust
```

That command installs the skill and the `knolo-code` MCP server. The server runs `npx -y @knolo/code@0.1.1 mcp`. The first start downloads this package. If the server is marked failed, set `MCP_TIMEOUT=120000` and reload MCP servers.

`@knolo/code@0.1.1` is published on npm as `latest`. A machine without this repository loads it with `npx -y @knolo/code@0.1.1 mcp`. The registry check is in [the code image doc](../../docs/code/README.md).

In the Plugins UI, add the marketplace `HiveForensics-AI/knolo-core`, install `knolo-code`, and trust it when asked.

## What the tools return

Each tool returns compact JSON: chunk text, path, line range, kind, id, `tokenEstimate`, and a receipt.

`code-image-tokens-v1` is `ceil(utf8ByteLength / 4)` of the returned chunk text. It is the comparison unit for the savings number below. It is not a model tokenizer.

| Tool                   | Result                                                     |
| ---------------------- | ---------------------------------------------------------- |
| `code_image_status`    | Whether `<root>/.knolo/workspace.pin.json` exists          |
| `code_image_build`     | Rebuilds `workspace.knolo` and the pin                     |
| `code_image_structure` | Signatures, exports, and type names for one file or symbol |
| `code_image_query`     | Up to `topK` chunks, default 5, with a `receipt-v1`        |
| `code_image_expand`    | One chunk, or a UTF-8 byte range inside it                 |

`code_image_query` calls `queryWithReceipt` with query expansion off, graph expansion off, and semantic off, then `verifyReceipt`. Structure and expand receipts are `code-image-block-v1`: `packDigest` plus the block source digest. A pin mismatch or a failed receipt returns `ok: false` and no chunk text.

The pin stores the file SHA-256 and `packDigest`. V4 packs have no `stateRoot`.

Add this to the workspace `.gitignore`:

```gitignore
.knolo/
```

## CLI

```bash
npx knolo-code build --root .
npx knolo-code structure --root . routes.ts
npx knolo-code query --root . --top-k 5 addRouteHandler
npx knolo-code expand --root . 'chunk/routes.ts#L10-L12/function/addRouteHandler'
```

## Function-calling sketch

```json
{
  "name": "code_image_query",
  "arguments": {
    "query": "addRouteHandler",
    "topK": 5,
    "path": "routes.ts",
    "type": "function"
  }
}
```

Call `code_image_structure` first. Call `code_image_expand` only for an id you need in full.

## Fixture savings

`examples/sample` is four TypeScript files: `types.ts`, `store.ts`, `routes.ts`, and `handler.ts`. The package test builds that tree, reads the structure of `routes.ts`, and queries `addRouteHandler`.

On the checked fixture, `code-image-tokens-v1` counts 31 tokens for the `routes.ts` skeleton and 275 for the file, which is 11.3%. A structure lookup plus `code_image_query` for `addRouteHandler` returns text that is 86.5% smaller than the four source files combined. The test prints that savings number and keeps the floor at 60%. A flipped image byte fails with `CODE_PIN_MISMATCH` and returns no chunk text.

The published tarball `code-0.1.0.tgz` (shasum `1d567732217cc871381156f786a3755a3d63e005`) produced the same two ratios on 2026-11-02: 31 of 275 tokens, and 1,166 returned bytes against 8,612 source bytes. That run is recorded in [the code image doc](../../docs/code/README.md).

The chunkers are `typescript-sourcefile/<typescript version>` and `python-scan-v1`. The scanner reads `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, and `.py`. JavaScript and TypeScript use the TypeScript parser. Structure signatures keep class headers, member signatures, and function signatures, and they drop implementation bodies. Python keeps `class` and `def` blocks, including decorator lines directly above the header. A blank line inside a class does not end the class. Files over 256 KiB, files with more than 200 chunks, and workspaces with more than 10,000 documents fail the build instead of dropping text.
