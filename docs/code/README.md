# Code image

`@knolo/code` builds a local V4 `.knolo` pack from TypeScript, JavaScript, and Python files. Grok Build installs it as the `knolo-code` plugin:

```bash
grok plugin install HiveForensics-AI/knolo-core#plugins/knolo-code --trust
```

The pack stores function, class, method, and export chunks plus a signature skeleton for each file. Query receipts are checked with `verifyReceipt` from `@knolo/core`. Structure and expand receipts carry `packDigest` and the block source digest. A pin mismatch returns an error and no chunk text.

The host owns the model. The tools do not embed the workspace and they do not claim that a retrieval result is a correct edit.

See the [package README](../../packages/code/README.md) and the [plugin README](../../plugins/knolo-code/README.md).

## Published check

`@knolo/code@0.1.0` is the npm `latest` release. The tarball is [code-0.1.0.tgz](https://registry.npmjs.org/@knolo/code/-/code-0.1.0.tgz) and its shasum is `1d567732217cc871381156f786a3755a3d63e005`.

On 2026-11-02 that tarball was installed in a clean directory, outside this repository's `node_modules`, and run against `packages/code/examples/sample` with the published `knolo-code` command. Node.js was v22.14.0. `code-image-tokens-v1` is `ceil(utf8Bytes / 4)` of the returned chunk text. That is the comparison unit in the table. It is separate from a model tokenizer.

| Check                                                   | Result                                                                                                                                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two builds                                              | Same pack bytes and `packDigest` `sha256-ce06e4eff791750a5d8987169960c0a19e8f639370eef38f0e104f21e29d8b5b`                                                                             |
| `routes.ts` skeleton                                    | 31 tokens, 11.3% of the file's 275 tokens. The skeleton omits `return notes`                                                                                                           |
| Structure plus `code_image_query` for `addRouteHandler` | 1,166 bytes against 8,612 bytes of the four sources, 86.5% smaller                                                                                                                     |
| Query receipt                                           | `receipt-v1`, verified, with a `replayHash`                                                                                                                                            |
| Expand of the first 6 UTF-8 bytes of that chunk         | text `export`, receipt `code-image-block-v1`                                                                                                                                           |
| One flipped pack byte                                   | exit 1, `CODE_PIN_MISMATCH`, and no chunk text                                                                                                                                         |
| Published MCP server                                    | lists `code_image_status`, `code_image_build`, `code_image_structure`, `code_image_query`, and `code_image_expand`. A query for `addRouteHandler` returned `ok: true` and `receipt-v1` |
