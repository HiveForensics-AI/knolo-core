# CLI pre-publish check, 2026-11-17

This record is the local check of main `80296ad09e1b0728c45eeecfde7e9a1aab1287c9`
on Node v22.14.0. It is not an npm publish. The CLI package version stayed
`6.2.8`. No tag was created and no GitHub Release was opened.

`npm test --workspace @knolo/cli` passed 125 tests, skipped 1, and failed 0.
The skipped test is `optional live Hub read path smoke`.

`@knolo/cli@6.2.8` is the npm release from the commit before `knolo ask`.
That tarball has no `ask.mjs` and no `--category` flag. A later stamp sets
the package file to `6.2.9`. This page does not bump a version.
