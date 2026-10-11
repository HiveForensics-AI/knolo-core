# Rollback

npm versions are immutable. Do not overwrite `6.0.0`, and do not delete git history or the `v6.0.0` tag.

If a severe defect is found after publication:

1. Leave `6.0.0` in the registry.
2. Deprecate it when users should stop installing it:

```bash
npm deprecate @knolo/core@6.0.0 "Severe defect. Install 6.0.1."
```

Repeat for each affected package that was actually published. Do not deprecate `@knolo/reflex@0.2.0` or `@knolo/evidence-gate@0.1.0` because of a KAR defect unless those packages themselves are at fault.

3. Fix on a new commit. Publish `6.0.1`. The default `latest` tag moves to `6.0.1` when that version is published.
4. Tag `v6.0.1` on the fix commit. Do not move `v6.0.0`.

`6.0.0-rc.1` stays the historical prerelease. Do not republish it and do not make it `latest`.
