# Post-publication smoke

Run these commands only after `6.0.0` is on the npm registry. They install from the registry, not from a local tarball. Use a clean directory outside this repository.

```bash
mkdir -p /tmp/knolo-v6-registry-smoke
cd /tmp/knolo-v6-registry-smoke
npm init -y
npm install @knolo/core
node -e "const p=require('@knolo/core/package.json'); if (p.version !== '6.0.0') { console.error(p.version); process.exit(1); } console.log(p.version)"
```

Then, still in that project, run a small script that:

1. Builds and mounts a Knowledge Image and runs a lexical query.
2. Compiles a CEG Source.
3. Creates a KAR session and evaluates it.
4. Builds an Evidence Dossier and verifies it.

The quickstart in `docs/kar/quickstart.md` is the shape of that script. The imports must be `@knolo/core`, `@knolo/core/kar`, and `@knolo/core/kar/authoring`.

CLI:

```bash
npm install @knolo/cli
npx knolo --version
```

Expect `@knolo/cli 6.0.0` and `@knolo/core 6.0.0`.

`knolo kar demo` and `knolo kar conformance` walk upward looking for this repository. From a bare install they do not see `examples/kar-v6` or `conformance/kar/v1`. Run those two commands from a checkout of tag `v6.0.0` after the registry install, or treat them as checkout checks rather than registry-only checks.

```bash
git checkout v6.0.0
npx knolo kar demo
npx knolo kar conformance
```

Stop if the resolved version is `5.5.1` or `6.0.0-rc.1`.
