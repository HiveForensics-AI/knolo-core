from __future__ import annotations

import base64
import hashlib
import struct
from pathlib import Path

import pytest

from knolo import (
    InvalidKnowledgeImageError,
    mount_knowledge_image_v5,
    query_knowledge_image_v5,
    verify_knowledge_image_v5,
)


FIXTURE_PATH = Path(__file__).resolve().parents[3] / "conformance" / "v5" / "knowledge-image-v5.fixture.base64"
EXPECTED_STATE_ROOT = "sha256-bc419264f60822bb8c601f01eb3020671e78056f4e6403ab6db087911d25d694"
EXPECTED_COMMIT_DIGEST = "sha256-7a6ed0a7e488ee085053d6d8d885141e0a8b6abd5c40bd552e4d2b10b721b177"
VQF_FIXTURE_PATH = Path(__file__).resolve().parents[3] / "conformance" / "vqf1" / "optional-query-index.fixture.base64"
REQUIRED_VQF_FIXTURE_PATH = Path(__file__).resolve().parents[3] / "conformance" / "vqf1" / "required-object-vqf.fixture.base64"


@pytest.fixture(scope="module")
def image_bytes() -> bytes:
    return base64.b64decode(FIXTURE_PATH.read_text(encoding="utf-8").strip())


def test_mounts_and_verifies_shared_v5_image(image_bytes: bytes):
    image = mount_knowledge_image_v5(image_bytes)
    verification = verify_knowledge_image_v5(image_bytes)

    assert image.state_root == EXPECTED_STATE_ROOT
    assert image.commit_digest == EXPECTED_COMMIT_DIGEST
    assert image.active_superblock == "A"
    assert len(image.objects) == 1
    assert image.objects[0].kind == "metadata"
    assert verification.valid is True
    assert verification.state_root == image.state_root
    assert verification.commit_digest == image.commit_digest


def test_mounts_frozen_vqf_optional_index_fixture():
    image = mount_knowledge_image_v5(base64.b64decode(VQF_FIXTURE_PATH.read_text(encoding="utf-8").strip()))
    assert image.state_root == "sha256-979904b0ce8920b8c12717a92cdd3f777b901c34f682e4023290241089bc694a"
    assert image.commit_digest == "sha256-7e7d49d8b1f69c378e3dfcc1ad013f67b8b3dc69e5b98c801ded964733582d22"
    assert len(image.segments) == 4


def test_required_vqf_fixture_is_rejected_until_decoder_parity_lands():
    data = base64.b64decode(REQUIRED_VQF_FIXTURE_PATH.read_text(encoding="utf-8").strip())
    with pytest.raises(InvalidKnowledgeImageError, match="flags|digest"):
        mount_knowledge_image_v5(data)


def test_v5_query_is_deterministic_over_utf8_objects(image_bytes: bytes):
    image = mount_knowledge_image_v5(image_bytes)
    result = query_knowledge_image_v5(image, 'FROM metadata SEARCH "hello" LIMIT 10')

    assert result.plan_root == "sha256-832b843bb24c188ec60f54689a2e6c3af7c4c8c1121c3c8fa782a89b06db5d11"
    assert result.result_root == "sha256-577f70602232871a16191a9648ddac3a8788f9508898ddad2f6a287efb489f9b"
    assert len(result.hits) == 1
    assert result.hits[0].object_id == image.objects[0].id
    assert result.hits[0].kind == "metadata"
    assert query_knowledge_image_v5(image, 'FROM metadata SEARCH "missing" LIMIT 10').hits == ()


@pytest.mark.parametrize("mutator", [lambda data: data[:-1], lambda data: data[:32] + bytes([data[32] ^ 1]) + data[33:]])
def test_v5_verification_fails_closed_on_truncation_or_corruption(image_bytes: bytes, mutator):
    with pytest.raises(InvalidKnowledgeImageError):
        mount_knowledge_image_v5(mutator(image_bytes))


def test_v5_query_rejects_invalid_bounds(image_bytes: bytes):
    image = mount_knowledge_image_v5(image_bytes)
    with pytest.raises(ValueError):
        query_knowledge_image_v5(image, "FROM metadata LIMIT 0")
    with pytest.raises(ValueError):
        query_knowledge_image_v5(image, "FROM metadata WHERE bytes = \"x\"")


def test_v5_rejects_unsupported_required_segment_flags(image_bytes: bytes):
    image = mount_knowledge_image_v5(image_bytes)
    corrupted = bytearray(image_bytes)
    object_segment = next(segment for segment in image.segments if segment["kind"] == 1)
    corrupted[object_segment["offset"] + 6] |= 1
    with pytest.raises(InvalidKnowledgeImageError, match="flags"):
        mount_knowledge_image_v5(corrupted)


def _segment_digest(payload: bytes) -> bytes:
    return hashlib.sha256(b"knolo:segment:v1\x00" + payload).digest()


def _append_optional(image: bytes, kind: int, payload: bytes) -> bytes:
    header = bytearray(48)
    header[0:4] = b"KSEG"
    header[4] = kind
    header[5] = 1
    struct.pack_into("<Q", header, 8, len(payload))
    header[16:48] = _segment_digest(payload)
    return image + bytes(header) + payload


def test_old_reader_skips_kind_129_when_required_segments_are_ordinary(image_bytes: bytes):
    original = mount_knowledge_image_v5(image_bytes)
    extended = _append_optional(image_bytes, 129, b"vqf-query-index-skip-test")
    image = mount_knowledge_image_v5(extended)
    assert image.state_root == original.state_root
    assert image.segments[-1]["kind"] == 129
    assert image.segments[-1]["flags"] == 0


def test_old_reader_rejects_flagged_required_segment_with_changed_payload(image_bytes: bytes):
    mutated = bytearray(image_bytes)
    offset = 16 + 128 * 2
    struct.pack_into("<H", mutated, offset + 6, 1)
    mutated[offset + 48] ^= 1
    with pytest.raises(InvalidKnowledgeImageError):
        mount_knowledge_image_v5(bytes(mutated))
