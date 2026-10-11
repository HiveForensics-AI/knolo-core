# Knolo 6.0.0 release records

These files prepare publication. They do not publish to npm, move a dist-tag, push git, or upload Hub artifacts.

| Record | Location |
| --- | --- |
| Readiness | [docs/kar/V6_GA_READINESS.md](../../docs/kar/V6_GA_READINESS.md) |
| Release notes | [docs/releases/v6.0.0.md](../../docs/releases/v6.0.0.md) |
| Package manifest | [docs/releases/v6.0.0-artifacts.json](../../docs/releases/v6.0.0-artifacts.json) |
| SHA-256 | [SHA256SUMS](SHA256SUMS) |
| Test summary | [TEST_SUMMARY.md](TEST_SUMMARY.md) |
| Security | [SECURITY.md](SECURITY.md) |
| Publication commands | [PUBLICATION.md](PUBLICATION.md) |
| Tag | [TAG.md](TAG.md) |
| GitHub release draft | [GITHUB_RELEASE.md](GITHUB_RELEASE.md) |
| Post-publish smoke | [POST_PUBLISH_SMOKE.md](POST_PUBLISH_SMOKE.md) |
| Rollback | [ROLLBACK.md](ROLLBACK.md) |
| Hub | [HUB.md](HUB.md) |

Version commit: `172fcf79a477db35cbe296b70a001ccf774652b4`.

The annotated tag `v6.0.0` points at the commit that contains this directory, and only after the Node 20 and Node 22 suites pass on that commit. `6.0.0-rc.1` stays the historical prerelease in git. It is not on the npm registry.
