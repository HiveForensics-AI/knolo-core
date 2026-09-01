from __future__ import annotations

import hashlib
import math
import os
import struct
from collections import Counter
from functools import cmp_to_key
from pathlib import Path
from typing import Any

from .errors import InvalidKnowledgeImageError
from .models import (
    KnowledgeHitV5,
    KnowledgeImageV5,
    KnowledgeImageVerificationV5,
    KnowledgeObjectV5,
    KnowledgeQueryHitV5,
    KnowledgeQueryResultV5,
)
from .tokenize import tokenize

_MAGIC = b"KNLOV5\x00\x00"
_SUPERBLOCK_MAGIC = b"KNLOSB1\x00"
_SEGMENT_MAGIC = b"KSEG"
_HEADER_SIZE = 16
_SUPERBLOCK_SIZE = 128
_SEGMENT_HEADER_SIZE = 48
_DATA_START = _HEADER_SIZE + _SUPERBLOCK_SIZE * 2
_MAX_SEGMENT_SIZE = 512 * 1024 * 1024
_MAX_SEGMENTS = 1024
_SHA256_PREFIX = "sha256-"


def mount_knowledge_image_v5(
    source: str | os.PathLike[str] | bytes | bytearray | memoryview,
) -> KnowledgeImageV5:
    """Mount and verify one V5 Knowledge Image from a path or bytes."""
    try:
        data = _source_bytes(source)
        return _parse_image(data)
    except InvalidKnowledgeImageError:
        raise
    except (OSError, ValueError, OverflowError, struct.error, UnicodeError, TypeError) as exc:
        raise InvalidKnowledgeImageError(f"Invalid V5 Knowledge Image: {exc}") from exc


def verify_knowledge_image_v5(
    source: str | os.PathLike[str] | bytes | bytearray | memoryview,
) -> KnowledgeImageVerificationV5:
    image = mount_knowledge_image_v5(source)
    return KnowledgeImageVerificationV5(
        valid=True,
        state_root=image.state_root,
        commit_digest=image.commit_digest,
        active_superblock=image.active_superblock,
    )


def query_knowledge_image_v5(
    image: KnowledgeImageV5 | str | os.PathLike[str] | bytes | bytearray | memoryview,
    query: str,
    *,
    top_k: int = 10,
    min_score: float = 0.0,
    kind: str | None = None,
) -> list[KnowledgeHitV5] | KnowledgeQueryResultV5:
    """Run V5 EQL, or the compact lexical helper for a plain text query."""
    if query.lstrip().upper().startswith("FROM "):
        return _query_eql(image, query)
    if not isinstance(top_k, int) or isinstance(top_k, bool) or top_k < 1:
        raise ValueError("query_knowledge_image_v5(...): top_k must be a positive integer")
    if isinstance(min_score, bool) or not isinstance(min_score, (int, float)) or not math.isfinite(float(min_score)) or min_score < 0:
        raise ValueError("query_knowledge_image_v5(...): min_score must be finite and >= 0")
    mounted = image if isinstance(image, KnowledgeImageV5) else mount_knowledge_image_v5(image)
    terms = tokenize(query)
    if not terms:
        return []

    documents: list[tuple[KnowledgeObjectV5, str, Counter[str]]] = []
    for obj in mounted.objects:
        if kind is not None and obj.kind != kind:
            continue
        text = obj.bytes.decode("utf-8", errors="replace")
        counts = Counter(tokenize(text))
        if counts:
            documents.append((obj, text, counts))
    if not documents:
        return []

    doc_count = len(documents)
    average_length = max(sum(sum(counts.values()) for _, _, counts in documents) / doc_count, 1.0)
    document_frequency = Counter(
        term for _, _, counts in documents for term in set(counts) if term in terms
    )
    hits: list[KnowledgeHitV5] = []
    for obj, text, counts in documents:
        length = max(sum(counts.values()), 1)
        score = 0.0
        for term in terms:
            term_frequency = counts.get(term, 0)
            if not term_frequency:
                continue
            df = document_frequency[term]
            idf = math.log(1.0 + (doc_count - df + 0.5) / (df + 0.5))
            k1 = 1.5
            b = 0.75
            score += idf * (term_frequency * (k1 + 1.0)) / (
                term_frequency + k1 * (1.0 - b + b * (length / average_length))
            )
        if score > 0 and score >= float(min_score):
            hits.append(KnowledgeHitV5(obj.id, obj.kind, score, text, dict(obj.meta)))
    hits.sort(key=lambda hit: (-hit.score, hit.object_id.encode("utf-8")))
    return hits[:top_k]


def parse_knowledge_query_v5(expression: str) -> dict[str, Any]:
    """Parse the bounded V5 EQL subset used by the shared query fixture."""
    tokens = _lex_query(expression)
    cursor = 0
    _expect_word(tokens, cursor, "FROM")
    cursor += 1
    if cursor >= len(tokens) or tokens[cursor][0] != "word":
        raise ValueError("V5 EQL FROM requires an object kind or *")
    kind_token = tokens[cursor][1]
    cursor += 1
    kind = None if kind_token == "*" else _normalize_query_text(kind_token)
    if kind == "":
        raise ValueError("V5 EQL object kind cannot be empty")

    filters: list[dict[str, Any]] = []
    joins: list[dict[str, Any]] = []
    while _is_word(tokens, cursor, "JOIN"):
        cursor += 1
        if cursor >= len(tokens) or tokens[cursor][0] != "word":
            raise ValueError("V5 EQL JOIN requires an object kind or *")
        join_kind_token = tokens[cursor][1]
        cursor += 1
        join_kind = None if join_kind_token == "*" else _normalize_query_text(join_kind_token)
        if not _is_word(tokens, cursor, "ON"):
            raise ValueError("V5 EQL JOIN requires ON")
        cursor += 1
        left_field, cursor = _read_query_field(tokens, cursor, "join")
        _expect_token(tokens, cursor, "equals", "V5 EQL JOIN currently supports only equality (=)")
        cursor += 1
        right_field, cursor = _read_query_field(tokens, cursor + 0, "join")
        joins.append({"kind": join_kind, "leftField": left_field, "rightField": right_field})
        if len(joins) > 4:
            raise ValueError("V5 EQL JOIN is limited to 4 clauses")

    if _is_word(tokens, cursor, "WHERE"):
        cursor += 1
        while True:
            field, cursor = _read_query_field(tokens, cursor, "where")
            _expect_token(tokens, cursor, "equals", "V5 EQL WHERE currently supports only equality (=)")
            cursor += 1
            if cursor >= len(tokens):
                raise ValueError("V5 EQL WHERE requires a literal")
            filters.append({"field": field, "op": "=", "value": _parse_literal(tokens[cursor])})
            cursor += 1
            if not _is_word(tokens, cursor, "AND"):
                break
            cursor += 1
        filters.sort(key=lambda item: (item["field"].encode("utf-8"), _scalar_key(item["value"]).encode("utf-8")))

    search: str | None = None
    if _is_word(tokens, cursor, "SEARCH"):
        cursor += 1
        if cursor >= len(tokens) or tokens[cursor][0] != "string":
            raise ValueError('V5 EQL SEARCH requires a quoted string')
        search = _normalize_query_text(tokens[cursor][1])
        cursor += 1
        if not search:
            raise ValueError("V5 EQL SEARCH cannot be empty")

    order_by: dict[str, str] | None = None
    if _is_word(tokens, cursor, "ORDER"):
        cursor += 1
        if not _is_word(tokens, cursor, "BY"):
            raise ValueError("V5 EQL ORDER requires BY")
        cursor += 1
        field, cursor = _read_query_field(tokens, cursor, "order")
        direction = "asc"
        if _is_word(tokens, cursor, "ASC") or _is_word(tokens, cursor, "DESC"):
            direction = tokens[cursor][1].lower()
            cursor += 1
        order_by = {"field": field, "direction": direction}

    limit = 100
    if _is_word(tokens, cursor, "LIMIT"):
        cursor += 1
        if cursor >= len(tokens) or tokens[cursor][0] != "word" or not tokens[cursor][1].isdigit():
            raise ValueError("V5 EQL LIMIT requires a positive integer")
        limit = int(tokens[cursor][1])
        cursor += 1
        if limit < 1 or limit > 1000:
            raise ValueError("V5 EQL LIMIT must be between 1 and 1000")
    if cursor != len(tokens):
        raise ValueError(f"Unexpected V5 EQL token: {tokens[cursor][1]}")

    plan: dict[str, Any] = {
        "version": 1,
        "source": "knowledge-image-v5",
        "kind": kind,
        "filters": filters,
        "search": search,
        "limit": limit,
    }
    if order_by is not None:
        plan["orderBy"] = order_by
    if joins:
        plan["joins"] = joins
    return plan


def _query_eql(
    image: KnowledgeImageV5 | str | os.PathLike[str] | bytes | bytearray | memoryview,
    expression: str,
) -> KnowledgeQueryResultV5:
    mounted = image if isinstance(image, KnowledgeImageV5) else mount_knowledge_image_v5(image)
    plan = parse_knowledge_query_v5(expression)
    matched: list[tuple[KnowledgeObjectV5, tuple[str, ...]]] = []
    for obj in mounted.objects:
        if plan["kind"] is not None and obj.kind != plan["kind"]:
            continue
        if any(not _matches_filter(obj, item) for item in plan["filters"]):
            continue
        if plan["search"] is not None:
            text = _normalize_query_text(obj.bytes.decode("utf-8", errors="replace"))
            if not all(term in text for term in plan["search"].split(" ")):
                continue
        joined = _resolve_joins(mounted.objects, obj, plan.get("joins", []))
        if joined is None:
            continue
        matched.append((obj, tuple(joined)))

    matched.sort(key=cmp_to_key(lambda left, right: _compare_query_objects(left[0], right[0], plan.get("orderBy"))))
    selected = matched[: plan["limit"]]
    hits = tuple(
        KnowledgeQueryHitV5(obj.id, obj.kind, joined)
        for obj, joined in selected
    )
    plan_root = _digest_domain("query-plan", _cbor_encode(plan))
    result_body: dict[str, Any] = {
        "stateRoot": mounted.state_root,
        "planRoot": plan_root,
        "objectIds": [hit.object_id for hit in hits],
    }
    if plan.get("joins"):
        result_body["joinedObjectIds"] = [list(hit.joined_object_ids) for hit in hits]
    result_root = _digest_domain("query-result", _cbor_encode(result_body))
    return KnowledgeQueryResultV5(1, mounted.state_root, plan, plan_root, hits, result_root)


def _lex_query(expression: str) -> list[tuple[str, str]]:
    if not isinstance(expression, str) or not expression.strip():
        raise ValueError("V5 EQL query must be a non-empty string")
    tokens: list[tuple[str, str]] = []
    cursor = 0
    while cursor < len(expression):
        while cursor < len(expression) and expression[cursor].isspace():
            cursor += 1
        if cursor >= len(expression):
            break
        if expression[cursor] == "=":
            tokens.append(("equals", "="))
            cursor += 1
            continue
        if expression[cursor] == '"':
            cursor += 1
            chars: list[str] = []
            closed = False
            while cursor < len(expression):
                char = expression[cursor]
                cursor += 1
                if char == '"':
                    closed = True
                    break
                if char == "\\":
                    if cursor >= len(expression) or expression[cursor] not in ('"', "\\"):
                        raise ValueError('V5 EQL only supports escaped quotes and backslashes')
                    chars.append(expression[cursor])
                    cursor += 1
                else:
                    chars.append(char)
            if not closed:
                raise ValueError("Unterminated V5 EQL string literal")
            tokens.append(("string", "".join(chars)))
            continue
        start = cursor
        while cursor < len(expression) and not expression[cursor].isspace() and expression[cursor] != "=":
            cursor += 1
        value = expression[start:cursor]
        if not value or not all(char.isalnum() or char in "_.*-" for char in value):
            raise ValueError(f"Invalid V5 EQL token: {value}")
        tokens.append(("word", value))
    return tokens


def _read_query_field(tokens: list[tuple[str, str]], cursor: int, context: str) -> tuple[str, int]:
    if cursor >= len(tokens) or tokens[cursor][0] != "word" or not _supported_field(tokens[cursor][1]):
        raise ValueError(f"Unsupported V5 EQL {context} field")
    return _normalize_field(tokens[cursor][1]), cursor + 1


def _parse_literal(token: tuple[str, str]) -> Any:
    kind, value = token
    if kind == "string":
        return _normalize_query_text(value)
    if kind != "word":
        raise ValueError("V5 EQL WHERE requires a scalar literal")
    if value == "true":
        return True
    if value == "false":
        return False
    if value == "null":
        return None
    if value.isdigit() or (value.startswith("-") and value[1:].isdigit()):
        number = int(value)
        if -(2**53) < number < 2**53:
            return number
    raise ValueError(f"Invalid V5 EQL literal: {value}")


def _matches_filter(obj: KnowledgeObjectV5, item: dict[str, Any]) -> bool:
    actual = _query_field(obj, item["field"])
    expected = item["value"]
    if not _is_scalar(actual):
        return False
    if isinstance(actual, str) and isinstance(expected, str):
        return _normalize_query_text(actual) == expected
    return actual == expected


def _resolve_joins(objects: tuple[KnowledgeObjectV5, ...], source: KnowledgeObjectV5, joins: list[dict[str, Any]]) -> list[str] | None:
    joined: list[str] = []
    for join in joins:
        left = _query_field(source, join["leftField"])
        if not _is_scalar(left):
            return None
        matches = [
            candidate.id
            for candidate in objects
            if (join["kind"] is None or candidate.kind == join["kind"])
            and _is_scalar(_query_field(candidate, join["rightField"]))
            and _same_scalar(_query_field(candidate, join["rightField"]), left)
        ]
        if not matches:
            return None
        joined.extend(matches)
    return sorted(set(joined), key=lambda value: value.encode("utf-8"))


def _compare_query_objects(left: KnowledgeObjectV5, right: KnowledgeObjectV5, order_by: dict[str, str] | None) -> int:
    if order_by:
        comparison = _compare_scalars(_query_field(left, order_by["field"]), _query_field(right, order_by["field"]))
        if comparison:
            return -comparison if order_by["direction"] == "desc" else comparison
    return _compare_utf8(left.id, right.id)


def _query_field(obj: KnowledgeObjectV5, field: str) -> Any:
    if field == "id":
        return obj.id
    if field == "kind":
        return obj.kind
    return obj.meta.get(field[5:])


def _compare_scalars(left: Any, right: Any) -> int:
    left_missing, right_missing = not _is_scalar(left), not _is_scalar(right)
    if left_missing or right_missing:
        return 0 if left_missing == right_missing else (1 if left_missing else -1)
    if left == right:
        return 0
    if isinstance(left, (int, float)) and not isinstance(left, bool) and isinstance(right, (int, float)) and not isinstance(right, bool):
        return -1 if left < right else 1
    if isinstance(left, str) and isinstance(right, str):
        return _compare_utf8(_normalize_query_text(left), _normalize_query_text(right))
    if isinstance(left, bool) and isinstance(right, bool):
        return 1 if left else -1
    return _compare_utf8(_scalar_key(left), _scalar_key(right))


def _is_scalar(value: Any) -> bool:
    return value is None or isinstance(value, (bool, int, str))


def _same_scalar(left: Any, right: Any) -> bool:
    if isinstance(left, str) and isinstance(right, str):
        return _normalize_query_text(left) == _normalize_query_text(right)
    return left == right


def _scalar_key(value: Any) -> str:
    if value is None:
        return "null:"
    if isinstance(value, bool):
        return f"boolean:{str(value).lower()}"
    if isinstance(value, int):
        return f"number:{value}"
    return f"string:{value}"


def _normalize_query_text(value: str) -> str:
    return " ".join(value.lower().split())


def _supported_field(field: str) -> bool:
    return field.lower() in ("id", "kind") or (field.lower().startswith("meta.") and all(char.isalnum() or char in "_-" for char in field[5:]))


def _normalize_field(field: str) -> str:
    lower = field.lower()
    return lower if lower in ("id", "kind") else f"meta.{lower[5:]}"


def _is_word(tokens: list[tuple[str, str]], cursor: int, expected: str) -> bool:
    return cursor < len(tokens) and tokens[cursor][0] == "word" and tokens[cursor][1].upper() == expected


def _expect_word(tokens: list[tuple[str, str]], cursor: int, expected: str) -> None:
    if not _is_word(tokens, cursor, expected):
        raise ValueError(f"V5 EQL query must start with {expected}")


def _expect_token(tokens: list[tuple[str, str]], cursor: int, kind: str, message: str) -> None:
    if cursor >= len(tokens) or tokens[cursor][0] != kind:
        raise ValueError(message)


def _compare_utf8(left: str, right: str) -> int:
    left_bytes = left.encode("utf-8")
    right_bytes = right.encode("utf-8")
    return (left_bytes > right_bytes) - (left_bytes < right_bytes)


def _parse_image(data: bytes) -> KnowledgeImageV5:
    if len(data) < _DATA_START:
        raise InvalidKnowledgeImageError("V5 image is truncated")
    if data[:8] != _MAGIC:
        raise InvalidKnowledgeImageError("invalid V5 image magic")
    version, reserved, superblock_size, flags = struct.unpack_from("<HHHH", data, 8)
    if version != 5 or superblock_size != _SUPERBLOCK_SIZE:
        raise InvalidKnowledgeImageError("unsupported V5 image header")
    del reserved, flags

    candidates = []
    for index, slot in enumerate(("A", "B")):
        candidate = _read_superblock(data, _HEADER_SIZE + index * _SUPERBLOCK_SIZE, slot)
        if candidate is not None:
            candidates.append(candidate)
    if not candidates:
        raise InvalidKnowledgeImageError("no valid V5 superblock")

    segments = []
    offset = _DATA_START
    seen: set[int] = set()
    while offset < len(data):
        if len(segments) >= _MAX_SEGMENTS:
            raise InvalidKnowledgeImageError("V5 image exceeds the segment limit")
        segment = _read_segment(data, offset)
        if segment["kind"] not in (1, 2, 3) and segment["kind"] < 128:
            raise InvalidKnowledgeImageError(f"unknown non-optional V5 segment: {segment['kind']}")
        if segment["kind"] <= 3 and segment["schema"] != 1:
            raise InvalidKnowledgeImageError("unsupported required V5 segment schema")
        if segment["kind"] in seen and segment["kind"] < 128:
            raise InvalidKnowledgeImageError("duplicate required V5 segment")
        seen.add(segment["kind"])
        segments.append(segment)
        offset += segment["length"]
    if offset != len(data):
        raise InvalidKnowledgeImageError("invalid V5 segment alignment")

    commit_segment = _find_segment(segments, 3)
    object_segment = _find_segment(segments, 1)
    event_segment = _find_segment(segments, 2)
    commit_payload = data[commit_segment["offset"] + _SEGMENT_HEADER_SIZE : commit_segment["offset"] + commit_segment["length"]]
    commit = _decode_commit(commit_payload)
    commit_digest = _digest_domain("commit", commit_payload)
    state_root = _digest_domain("state", _digest_bytes(commit_digest))
    active = next(
        (
            candidate
            for candidate in sorted(candidates, key=lambda item: item["generation"], reverse=True)
            if candidate["commit_offset"] == commit_segment["offset"]
            and candidate["commit_length"] == commit_segment["length"]
            and candidate["commit_digest"] == commit_digest
            and candidate["state_root"] == state_root
        ),
        None,
    )
    if active is None:
        raise InvalidKnowledgeImageError("no V5 superblock points to a valid commit")
    if commit["objectSegmentDigest"] != object_segment["digest"] or commit["eventSegmentDigest"] != event_segment["digest"]:
        raise InvalidKnowledgeImageError("V5 commit segment digest mismatch")

    object_payload = data[object_segment["offset"] + _SEGMENT_HEADER_SIZE : object_segment["offset"] + object_segment["length"]]
    event_payload = data[event_segment["offset"] + _SEGMENT_HEADER_SIZE : event_segment["offset"] + event_segment["length"]]
    objects = _decode_objects(object_payload)
    events = _decode_events(event_payload)
    if _digest_domain("object-root", _cbor_encode([obj.id for obj in objects])) != commit["objectRoot"]:
        raise InvalidKnowledgeImageError("V5 object root mismatch")
    if _digest_domain("event-root", _cbor_encode([event["id"] for event in events])) != commit["eventRoot"]:
        raise InvalidKnowledgeImageError("V5 event root mismatch")

    return KnowledgeImageV5(
        bytes(data),
        state_root,
        commit_digest,
        commit,
        tuple(objects),
        tuple(events),
        tuple(segments),
        active["slot"],
    )


def _read_superblock(data: bytes, offset: int, slot: str) -> dict[str, Any] | None:
    raw = data[offset : offset + _SUPERBLOCK_SIZE]
    if len(raw) != _SUPERBLOCK_SIZE or raw[:8] != _SUPERBLOCK_MAGIC:
        return None
    generation, commit_offset, commit_length = struct.unpack_from("<QQQ", raw, 8)
    if commit_length < _SEGMENT_HEADER_SIZE or commit_offset + commit_length > len(data):
        return None
    try:
        commit_digest = _bytes_to_digest(raw[32:64])
        state_root = _bytes_to_digest(raw[64:96])
        checksum = _bytes_to_digest(raw[96:128])
    except InvalidKnowledgeImageError:
        return None
    if checksum != _digest_domain("superblock", raw[:96]):
        return None
    return {
        "slot": slot,
        "generation": generation,
        "commit_offset": commit_offset,
        "commit_length": commit_length,
        "commit_digest": commit_digest,
        "state_root": state_root,
    }


def _read_segment(data: bytes, offset: int) -> dict[str, Any]:
    if len(data) - offset < _SEGMENT_HEADER_SIZE:
        raise InvalidKnowledgeImageError("invalid V5 segment header bounds")
    raw = data[offset : offset + _SEGMENT_HEADER_SIZE]
    if raw[:4] != _SEGMENT_MAGIC:
        raise InvalidKnowledgeImageError("invalid V5 segment magic")
    kind, schema, flags = struct.unpack_from("<BBH", raw, 4)
    (payload_length,) = struct.unpack_from("<Q", raw, 8)
    if payload_length > _MAX_SEGMENT_SIZE or offset + _SEGMENT_HEADER_SIZE + payload_length > len(data):
        raise InvalidKnowledgeImageError("invalid V5 segment length")
    length = _SEGMENT_HEADER_SIZE + payload_length
    payload = data[offset + _SEGMENT_HEADER_SIZE : offset + length]
    digest = _bytes_to_digest(raw[16:48])
    if digest != _digest_domain("segment", payload):
        raise InvalidKnowledgeImageError(f"V5 segment digest mismatch: {kind}")
    return {
        "kind": kind,
        "schema": schema,
        "flags": flags,
        "offset": offset,
        "length": length,
        "payloadLength": payload_length,
        "digest": digest,
    }


def _decode_objects(payload: bytes) -> list[KnowledgeObjectV5]:
    value = _decode_canonical_cbor(payload)
    if not isinstance(value, list):
        raise InvalidKnowledgeImageError("invalid V5 object segment")
    objects = []
    for entry in value:
        obj = _as_map(entry)
        object_id = _as_digest(obj.get("id"))
        kind = _as_string(obj.get("kind"))
        raw_bytes = _as_bytes(obj.get("bytes"))
        meta = _as_map(obj.get("meta"))
        if _digest_domain("object", _cbor_encode({"kind": kind, "bytes": raw_bytes, "meta": meta})) != object_id:
            raise InvalidKnowledgeImageError("V5 object identity mismatch")
        objects.append(KnowledgeObjectV5(object_id, kind, raw_bytes, meta))
    return objects


def _decode_events(payload: bytes) -> list[dict[str, Any]]:
    value = _decode_canonical_cbor(payload)
    if not isinstance(value, list):
        raise InvalidKnowledgeImageError("invalid V5 event segment")
    events = []
    for entry in value:
        event = _as_map(entry)
        event_id = _as_digest(event.get("id"))
        normalized = {
            "version": _as_int(event.get("version")),
            "transactionId": _as_digest(event.get("transactionId")),
            "parents": _as_digest_list(event.get("parents")),
            "actor": _as_string(event.get("actor")),
            "actorCounter": _as_int(event.get("actorCounter")),
            "kind": _as_string(event.get("kind")),
            "target": _as_digest(event.get("target")),
            "payload": _as_digest(event.get("payload")),
            "provenance": _as_map(event.get("provenance")),
        }
        if normalized["version"] != 1 or not normalized["actor"] or normalized["actorCounter"] < 1 or _digest_domain("event", _cbor_encode(normalized)) != event_id:
            raise InvalidKnowledgeImageError("V5 event identity mismatch")
        events.append({**normalized, "id": event_id})
    return events


def _decode_commit(payload: bytes) -> dict[str, Any]:
    value = _as_map(_decode_canonical_cbor(payload))
    commit = {
        "version": _as_int(value.get("version")),
        "parents": _as_digest_list(value.get("parents")),
        "transactionRoot": _as_digest(value.get("transactionRoot")),
        "objectRoot": _as_digest(value.get("objectRoot")),
        "eventRoot": _as_digest(value.get("eventRoot")),
        "views": _as_digest_map(value.get("views")),
        "schemaRoot": _as_digest(value.get("schemaRoot")),
        "policyRoot": _as_digest(value.get("policyRoot")),
        "runtimeContract": _as_digest(value.get("runtimeContract")),
        "sequence": _as_int(value.get("sequence")),
        "actor": _as_string(value.get("actor")),
        "objectSegmentDigest": _as_digest(value.get("objectSegmentDigest")),
        "eventSegmentDigest": _as_digest(value.get("eventSegmentDigest")),
    }
    if commit["version"] != 1 or commit["sequence"] < 1 or not commit["actor"] or len(set(commit["parents"])) != len(commit["parents"]):
        raise InvalidKnowledgeImageError("malformed V5 commit")
    return commit


def _decode_canonical_cbor(data: bytes) -> Any:
    reader = _CborReader(data)
    value = reader.read()
    if reader.offset != len(data):
        raise InvalidKnowledgeImageError("trailing bytes in V5 CBOR payload")
    if _cbor_encode(value) != data:
        raise InvalidKnowledgeImageError("non-canonical V5 CBOR payload")
    return value


class _CborReader:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.offset = 0

    def read(self) -> Any:
        initial = self._byte()
        major, additional = initial >> 5, initial & 31
        if major == 0:
            return self._length(additional)
        if major == 1:
            return -1 - self._length(additional)
        if major == 2:
            return self._bytes(self._length(additional))
        if major == 3:
            try:
                return self._bytes(self._length(additional)).decode("utf-8")
            except UnicodeDecodeError as exc:
                raise InvalidKnowledgeImageError("V5 CBOR text is not UTF-8") from exc
        if major == 4:
            length = self._length(additional)
            if length > len(self.data) - self.offset:
                raise InvalidKnowledgeImageError("truncated V5 CBOR array")
            return [self.read() for _ in range(length)]
        if major == 5:
            length = self._length(additional)
            if length > len(self.data) - self.offset:
                raise InvalidKnowledgeImageError("truncated V5 CBOR map")
            result: dict[str, Any] = {}
            for _ in range(length):
                key = self.read()
                if not isinstance(key, str) or key in result:
                    raise InvalidKnowledgeImageError("V5 CBOR map keys must be unique text")
                result[key] = self.read()
            return result
        if major == 7 and additional == 20:
            return False
        if major == 7 and additional == 21:
            return True
        if major == 7 and additional == 22:
            return None
        raise InvalidKnowledgeImageError("unsupported V5 CBOR value")

    def _byte(self) -> int:
        if self.offset >= len(self.data):
            raise InvalidKnowledgeImageError("truncated V5 CBOR value")
        value = self.data[self.offset]
        self.offset += 1
        return value

    def _length(self, additional: int) -> int:
        if additional < 24:
            return additional
        if additional == 24:
            return self._byte()
        if additional == 25:
            return int.from_bytes(self._take(2), "big")
        if additional == 26:
            return int.from_bytes(self._take(4), "big")
        if additional == 27:
            return int.from_bytes(self._take(8), "big")
        raise InvalidKnowledgeImageError("indefinite-length V5 CBOR is not allowed")

    def _bytes(self, length: int) -> bytes:
        return self._take(length)

    def _take(self, length: int) -> bytes:
        if length < 0 or length > len(self.data) - self.offset:
            raise InvalidKnowledgeImageError("truncated V5 CBOR value")
        start = self.offset
        self.offset += length
        return self.data[start : self.offset]


def _cbor_encode(value: Any) -> bytes:
    if value is None:
        return b"\xf6"
    if value is False:
        return b"\xf4"
    if value is True:
        return b"\xf5"
    if isinstance(value, str):
        raw = value.encode("utf-8")
        return _cbor_length(3, len(raw)) + raw
    if isinstance(value, bytes):
        return _cbor_length(2, len(value)) + value
    if isinstance(value, int) and not isinstance(value, bool):
        return _cbor_length(0 if value >= 0 else 1, value if value >= 0 else -1 - value)
    if isinstance(value, list):
        return _cbor_length(4, len(value)) + b"".join(_cbor_encode(item) for item in value)
    if isinstance(value, dict):
        entries = sorted(value.items(), key=lambda item: item[0].encode("utf-8"))
        return _cbor_length(5, len(entries)) + b"".join(_cbor_encode(key) + _cbor_encode(item) for key, item in entries)
    raise InvalidKnowledgeImageError("unsupported value in V5 canonical CBOR")


def _cbor_length(major: int, length: int) -> bytes:
    if length < 24:
        return bytes([(major << 5) | length])
    if length <= 0xFF:
        return bytes([(major << 5) | 24, length])
    if length <= 0xFFFF:
        return bytes([(major << 5) | 25]) + length.to_bytes(2, "big")
    if length <= 0xFFFFFFFF:
        return bytes([(major << 5) | 26]) + length.to_bytes(4, "big")
    return bytes([(major << 5) | 27]) + length.to_bytes(8, "big")


def _source_bytes(source: str | os.PathLike[str] | bytes | bytearray | memoryview) -> bytes:
    if isinstance(source, (bytes, bytearray, memoryview)):
        return bytes(source)
    return Path(os.fspath(source)).read_bytes()


def _digest_domain(domain: str, payload: bytes) -> str:
    return _SHA256_PREFIX + hashlib.sha256(f"knolo:{domain}:v1\x00".encode() + payload).hexdigest()


def _digest_bytes(value: str) -> bytes:
    if not isinstance(value, str) or not value.startswith(_SHA256_PREFIX) or len(value) != len(_SHA256_PREFIX) + 64:
        raise InvalidKnowledgeImageError("invalid V5 digest")
    try:
        return bytes.fromhex(value[len(_SHA256_PREFIX) :])
    except ValueError as exc:
        raise InvalidKnowledgeImageError("invalid V5 digest") from exc


def _bytes_to_digest(value: bytes) -> str:
    if len(value) != 32:
        raise InvalidKnowledgeImageError("invalid V5 digest bytes")
    return _SHA256_PREFIX + value.hex()


def _find_segment(segments: list[dict[str, Any]], kind: int) -> dict[str, Any]:
    for segment in segments:
        if segment["kind"] == kind:
            return segment
    raise InvalidKnowledgeImageError(f"V5 image is missing required segment {kind}")


def _as_map(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise InvalidKnowledgeImageError("expected V5 CBOR map")
    return value


def _as_string(value: Any) -> str:
    if not isinstance(value, str):
        raise InvalidKnowledgeImageError("expected V5 text value")
    return value


def _as_int(value: Any) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise InvalidKnowledgeImageError("expected V5 integer value")
    return value


def _as_bytes(value: Any) -> bytes:
    if not isinstance(value, bytes):
        raise InvalidKnowledgeImageError("expected V5 byte string")
    return value


def _as_digest(value: Any) -> str:
    digest = _as_string(value)
    _digest_bytes(digest)
    return digest


def _as_digest_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        raise InvalidKnowledgeImageError("expected V5 digest array")
    return [_as_digest(item) for item in value]


def _as_digest_map(value: Any) -> dict[str, str]:
    return {key: _as_digest(item) for key, item in _as_map(value).items()}
