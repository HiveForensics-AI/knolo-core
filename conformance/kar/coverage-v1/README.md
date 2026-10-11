# KAR coverage vectors

Twelve hand-authored vectors for the evidence gap report. They run on V5 Knowledge Images through `@knolo/core/kar`. They do not replace [`conformance/kar/v1`](../v1/README.md), and they do not change `kar-1-research-1`.

```bash
npm run build --workspace @knolo/core
node conformance/kar/coverage-v1/run.mjs
```

`expected.json` locks disposition, status, code, unadmitted tokens, plan root, KAR root, and coverage root. It does not lock evidence text. `met` is not proof. `gap` is not a false proposition. `blocked` means that plan did not decide.

The contracts-v4 vector records `DomainPackRoot` `sha256-1ffea8ded1877f28ce61c9e98bb79644f8bbe237c22baae6984983d92ede39a5`. That pack stays review-required. The vector does not read pack fixtures as questions.
