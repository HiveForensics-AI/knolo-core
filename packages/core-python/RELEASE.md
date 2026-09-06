# Release Checklist

- [ ] Confirm the `knolo` distribution name is still available on PyPI, or choose a fallback package name before release if it is not.
- [ ] `cd packages/core-python && python -m pip install -e ".[dev]"`
- [ ] `cd packages/core-python && python -m pytest`
- [ ] Confirm the Python CI workflow passes on Python 3.10, 3.11, 3.12, and 3.13.
- [ ] Confirm the publish workflow runs only on GitHub release publication and uses Trusted Publishing with no hardcoded secrets.
- [ ] Publish the GitHub release from the web UI with tag `v5.5.0`; wait for both `python-publish` jobs to pass.
- [ ] Smoke install `knolo==5.5.0` from PyPI in a clean environment and run a basic `mount_pack` / `query` check.
- [ ] Yank a bad PyPI release instead of republishing the same tag if a release needs to be rolled back.

The GitHub `python-publish` workflow builds the wheel and sdist and submits
them to PyPI through Trusted Publishing. Local `python -m build` and
`twine upload` commands are not part of the publication procedure.
# V5 compatibility note

The Python runtime is a read-only V5 Knowledge Image verifier and lexical
object-query profile. It preserves the legacy V1–V3 pack reader/query API, but
does not claim V4 receipt/analyzer equivalence or implement V5 writes, Studio,
authority administration, or synchronization.
