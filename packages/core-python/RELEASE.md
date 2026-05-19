# Release Checklist

- [ ] Confirm the `knolo` distribution name is still available on PyPI, or choose a fallback package name before release if it is not.
- [ ] `cd packages/core-python && python -m pip install -e ".[dev]"`
- [ ] `cd packages/core-python && python -m pytest`
- [ ] `cd packages/core-python && python -m build`
- [ ] `cd packages/core-python && python -m twine check dist/*`
- [ ] Verify the wheel contents with `python -m zipfile -l dist/knolo-*.whl`.
- [ ] Verify the sdist contents with `tar -tzf dist/knolo-*.tar.gz`.
- [ ] Confirm the Python CI workflow passes on Python 3.10, 3.11, 3.12, and 3.13.
- [ ] Confirm the publish workflow only runs on GitHub release publication and uses Trusted Publishing with no hardcoded secrets.
- [ ] Smoke install the built wheel in a clean environment and run a basic `mount_pack` / `query` check.
- [ ] Yank a bad PyPI release instead of republishing the same tag if a release needs to be rolled back.
