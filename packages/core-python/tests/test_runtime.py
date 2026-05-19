from __future__ import annotations

import importlib.util
import struct
import zipfile
from pathlib import Path

import pytest

from knolo import (
    InvalidPackError,
    QueryOptions,
    mount_pack,
    mount_pack_from_bytes,
    query,
)


FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "simple.knolo"
BUILD_BACKEND_PATH = Path(__file__).resolve().parents[1] / "setuptools" / "build_meta.py"


@pytest.fixture(scope="module")
def fixture_bytes() -> bytes:
    return FIXTURE_PATH.read_bytes()


@pytest.fixture(scope="module")
def fixture_pack(fixture_bytes: bytes):
    return mount_pack_from_bytes(fixture_bytes)


def _load_build_backend():
    spec = importlib.util.spec_from_file_location("knolo_local_build_meta", BUILD_BACKEND_PATH)
    assert spec is not None
    assert spec.loader is not None

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_mounts_from_path_and_bytes(fixture_bytes: bytes):
    pack_from_path = mount_pack(FIXTURE_PATH)
    pack_from_bytes = mount_pack_from_bytes(fixture_bytes)

    assert pack_from_path == pack_from_bytes


def test_preserves_metadata_and_block_fields(fixture_pack):
    assert fixture_pack.meta.version == 3
    assert fixture_pack.meta.stats.docs == 3
    assert fixture_pack.meta.stats.blocks == 3
    assert fixture_pack.meta.stats.terms == 4
    assert fixture_pack.blocks == ("alpha beta", "beta gamma delta", "alpha beta")
    assert fixture_pack.headings == (
        "Alpha Intro",
        "Beta Guide",
        "Alpha Reference",
    )
    assert fixture_pack.doc_ids == ("intro.md", "runtime.md", "other.md")
    assert fixture_pack.namespaces == ("docs.alpha", "docs.beta", "docs.alpha")
    assert fixture_pack.block_token_lens == (2, 3, 2)


def test_query_is_deterministic_and_ranks_by_block_id_tie_breaker(fixture_pack):
    hits = query(fixture_pack, "alpha beta", top_k=5)

    assert [hit.source for hit in hits[:2]] == ["intro.md", "other.md"]
    assert hits[0].score == pytest.approx(hits[1].score)
    assert hits[0].block_id < hits[1].block_id


def test_query_supports_namespace_and_source_filters(fixture_pack):
    namespace_hits = query(fixture_pack, "alpha", namespace="docs.alpha", top_k=5)
    assert [hit.source for hit in namespace_hits] == ["intro.md", "other.md"]

    source_hits = query(fixture_pack, "alpha", source="other.md", top_k=5)
    assert [hit.source for hit in source_hits] == ["other.md"]


def test_blank_query_returns_empty_list(fixture_pack):
    assert query(fixture_pack, "") == []
    assert query(fixture_pack, "   ") == []


def test_top_k_limits_results(fixture_pack):
    hits = query(fixture_pack, "beta", top_k=1)
    assert len(hits) == 1
    assert hits[0].source == "intro.md"


def test_min_score_filters_results(fixture_pack):
    assert query(fixture_pack, "alpha", min_score=10.0) == []


def test_query_options_are_merged_with_explicit_kwargs(fixture_pack):
    options = QueryOptions(top_k=1, namespace="docs.alpha")
    hits = query(fixture_pack, "alpha beta", options, top_k=2)
    assert len(hits) == 2
    assert all(hit.namespace == "docs.alpha" for hit in hits)


def test_non_editable_wheel_uses_top_level_package_paths(tmp_path):
    build_meta = _load_build_backend()
    wheel_name = build_meta.build_wheel(tmp_path)
    wheel_path = tmp_path / wheel_name

    assert wheel_path.exists()

    with zipfile.ZipFile(wheel_path) as wheel:
        names = wheel.namelist()

    assert "knolo/__init__.py" in names
    assert "knolo/errors.py" in names
    assert "knolo/models.py" in names
    assert "knolo/runtime.py" in names
    assert "knolo/tokenize.py" in names
    assert "knolo/py.typed" in names
    assert not any(name.startswith("src/knolo/") for name in names)


@pytest.mark.parametrize(
    "payload",
    [
        b"not-json-at-all",
        struct.pack("<I", 8) + b"{not js" + b"\x00\x00\x00\x00",
        struct.pack("<I", 2) + b"{}" + struct.pack("<I", 0) + b"" + struct.pack("<I", 0) + struct.pack("<I", 0),
    ],
)
def test_invalid_inputs_raise_invalid_pack_error(payload: bytes):
    with pytest.raises(InvalidPackError):
        mount_pack_from_bytes(payload)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"top_k": 0},
        {"top_k": -1},
        {"min_score": -0.01},
        {"min_score": float("inf")},
    ],
)
def test_invalid_query_options_raise_value_error(fixture_pack, kwargs):
    with pytest.raises(ValueError):
        query(fixture_pack, "alpha", **kwargs)
