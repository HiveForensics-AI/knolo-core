# Code image

`@knolo/code` builds a local V4 `.knolo` pack from TypeScript, JavaScript, and Python files. Grok Build installs it as the `knolo-code` plugin:

```bash
grok plugin install HiveForensics-AI/knolo-core#plugins/knolo-code --trust
```

The pack stores function, class, method, and export chunks plus a signature skeleton for each file. Query receipts are checked with `verifyReceipt` from `@knolo/core`. Structure and expand receipts carry `packDigest` and the block source digest. A pin mismatch returns an error and no chunk text.

The host owns the model. The tools do not embed the workspace and they do not claim that a retrieval result is a correct edit.

See the [package README](../../packages/code/README.md) and the [plugin README](../../plugins/knolo-code/README.md).
