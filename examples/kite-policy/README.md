# KITE policy example

This is a small synthetic image, not a customer corpus and not a guarantee.

The image contains a security policy and a contractor exception. It does not
contain a contractor approval. The contract requires that approval. The
verdict is `UNDERDETERMINED`. A missing approval is not recorded as a denial.

Build `@knolo/core` first. From a knolo-core checkout:

```bash
node examples/kite-policy/run.mjs
```

`knolo kite` in npm `latest` `@knolo/cli@6.2.9` evaluates the
same files. Published `@knolo/cli@6.2.5` does not include that command.
