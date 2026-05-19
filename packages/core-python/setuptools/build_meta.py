from __future__ import annotations

import base64
import csv
import hashlib
import io
import tarfile
import textwrap
import time
import zipfile
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
PACKAGE_NAME = "knolo"
VERSION = "0.1.0"
DIST_INFO = f"{PACKAGE_NAME}-{VERSION}.dist-info"
WHEEL_NAME = f"{PACKAGE_NAME}-{VERSION}-py3-none-any.whl"
SDIST_NAME = f"{PACKAGE_NAME}-{VERSION}.tar.gz"


def get_requires_for_build_wheel(config_settings=None):
    return []


def get_requires_for_build_editable(config_settings=None):
    return []


def get_requires_for_build_sdist(config_settings=None):
    return []


def prepare_metadata_for_build_wheel(metadata_directory, config_settings=None):
    return _write_metadata_dir(Path(metadata_directory))


def prepare_metadata_for_build_editable(metadata_directory, config_settings=None):
    return _write_metadata_dir(Path(metadata_directory))


def build_wheel(wheel_directory, config_settings=None, metadata_directory=None):
    return _build_wheel(Path(wheel_directory), editable=False)


def build_editable(wheel_directory, config_settings=None, metadata_directory=None):
    return _build_wheel(Path(wheel_directory), editable=True)


def build_sdist(sdist_directory, config_settings=None):
    out_dir = Path(sdist_directory)
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / SDIST_NAME
    root_name = f"{PACKAGE_NAME}-{VERSION}"

    with tarfile.open(target, "w:gz") as tar:
        for path in _iter_sdist_paths():
            arcname = Path(root_name) / path.relative_to(ROOT)
            info = tar.gettarinfo(str(path), arcname=str(arcname))
            if path.is_file():
                with path.open("rb") as fh:
                    tar.addfile(info, fh)
            else:
                tar.addfile(info)

        pkg_info = _metadata_text().encode("utf-8")
        info = tarfile.TarInfo(name=f"{root_name}/PKG-INFO")
        info.size = len(pkg_info)
        info.mtime = int(time.time())
        info.mode = 0o644
        tar.addfile(info, io.BytesIO(pkg_info))

    return SDIST_NAME


def _build_wheel(out_dir: Path, *, editable: bool) -> str:
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / WHEEL_NAME
    files: list[tuple[str, bytes]] = []

    if editable:
        source_path = str((ROOT / "src").resolve())
        files.append((f"{PACKAGE_NAME}.pth", (source_path + "\n").encode("utf-8")))
    else:
        for rel_path in _wheel_files():
            src = ROOT / rel_path
            arcname = rel_path.relative_to("src").as_posix()
            files.append((arcname, src.read_bytes()))

    metadata_prefix = DIST_INFO
    files.append((f"{metadata_prefix}/METADATA", _metadata_text().encode("utf-8")))
    files.append((f"{metadata_prefix}/WHEEL", _wheel_text().encode("utf-8")))
    files.append((f"{metadata_prefix}/top_level.txt", b"knolo\n"))

    record_rows = []
    for arcname, data in files:
        digest = hashlib.sha256(data).digest()
        encoded = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
        record_rows.append((arcname, f"sha256={encoded}", str(len(data))))
    record_rows.append((f"{metadata_prefix}/RECORD", "", ""))

    record_bytes = _render_record(record_rows)
    files.append((f"{metadata_prefix}/RECORD", record_bytes))

    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for arcname, data in files:
            zf.writestr(arcname, data)

    return WHEEL_NAME


def _write_metadata_dir(metadata_directory: Path) -> str:
    dist_info = metadata_directory / DIST_INFO
    dist_info.mkdir(parents=True, exist_ok=True)
    (dist_info / "METADATA").write_text(_metadata_text(), encoding="utf-8")
    (dist_info / "WHEEL").write_text(_wheel_text(), encoding="utf-8")
    (dist_info / "top_level.txt").write_text("knolo\n", encoding="utf-8")
    return DIST_INFO


def _metadata_text() -> str:
    headers = [
        "Metadata-Version: 2.3",
        f"Name: {PACKAGE_NAME}",
        f"Version: {VERSION}",
        "Summary: Pure-Python runtime for mounting and querying .knolo packs.",
        "Author: Knolo",
        "License: Apache-2.0",
        "Requires-Python: >=3.10",
        "Description-Content-Type: text/markdown",
        "Provides-Extra: dev",
        'Requires-Dist: build>=1.2; extra == "dev"',
        'Requires-Dist: pytest>=8; extra == "dev"',
        'Requires-Dist: twine>=5; extra == "dev"',
    ]
    return "\n".join(headers) + "\n\n" + _read_readme().rstrip() + "\n"


def _wheel_text() -> str:
    return textwrap.dedent(
        f"""\
        Wheel-Version: 1.0
        Generator: knolo-local-backend
        Root-Is-Purelib: true
        Tag: py3-none-any
        """
    ).strip() + "\n"


def _read_readme() -> str:
    return (ROOT / "README.md").read_text(encoding="utf-8")


def _wheel_files() -> list[Path]:
    return [
        Path("src/knolo/__init__.py"),
        Path("src/knolo/errors.py"),
        Path("src/knolo/models.py"),
        Path("src/knolo/runtime.py"),
        Path("src/knolo/tokenize.py"),
        Path("src/knolo/py.typed"),
    ]


def _iter_sdist_paths() -> Iterable[Path]:
    skip_dirs = {
        ".git",
        "__pycache__",
        ".pytest_cache",
        ".mypy_cache",
        ".python-user-base",
        ".ruff_cache",
        ".tox",
        "dist",
    }
    for path in ROOT.rglob("*"):
        if any(part in skip_dirs for part in path.parts):
            continue
        if path.is_dir():
            continue
        yield path


def _render_record(rows: list[tuple[str, str, str]]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")
