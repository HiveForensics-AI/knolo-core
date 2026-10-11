# Tag

Create the annotated tag only after the Node 20 and Node 22 suites pass on the commit that contains `docs/kar/V6_GA_READINESS.md`. Do not tag a different commit. Do not push unless a person asks.

```bash
git status
git rev-parse HEAD
git tag -a v6.0.0 -m "Knolo 6.0.0"
git rev-parse v6.0.0^{}
```

The tag object should point at that HEAD. `git status` should show no modifications to tracked files. Untracked research corpora and `examples/kar-real/` stay untracked and are not part of the tag.

Existing version tags in this repository are annotated. `v6.0.0` follows that convention.
