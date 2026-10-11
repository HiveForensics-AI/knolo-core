# Release Checklist

npm `@knolo/core` and `@knolo/cli` were published as `5.5.1` from tag `v5.5.1`.
PyPI has `knolo==5.5.0`. The Python package in this tree is `5.5.1`. The
`v5.5.1` release built `5.5.0` from that tag and PyPI rejected the duplicate
upload. `python-publish` skips a version that is already on PyPI and uploads
`5.5.1` from a commit that contains that version.

- [ ] Confirm the `knolo` distribution name is still available on PyPI, or choose a fallback package name before release if it is not.
- [ ] `cd packages/core-python && python -m pip install -e ".[dev]"`
- [ ] `cd packages/core-python && python -m pytest`
- [ ] Confirm the Python CI workflow passes on Python 3.10, 3.11, 3.12, and 3.13.
- [ ] Confirm the publish workflow uses Trusted Publishing with no hardcoded secrets, and skips a version that is already on PyPI.
- [ ] Run `python-publish` from a commit whose `pyproject.toml` says `5.5.1`. Do not rerun it from tag `v5.5.1`; that tag still builds `5.5.0`.
- [ ] Smoke install `knolo==5.5.1` from PyPI in a clean environment and run a basic `mount_pack` / `query` check.
- [ ] Yank a bad PyPI release instead of republishing the same tag if a release needs to be rolled back.

The GitHub `python-publish` workflow builds the wheel and sdist and submits
them to PyPI through Trusted Publishing. Local `python -m build` and
`twine upload` commands are not part of the publication procedure.

# V5 compatibility note

The Python runtime is a read-only V5 Knowledge Image verifier and lexical
object-query profile. It preserves the legacy V1–V3 pack reader/query API, but
does not claim V4 receipt/analyzer equivalence or implement V5 writes, Studio,
authority administration, or synchronization.
