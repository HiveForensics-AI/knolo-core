from __future__ import annotations

import json
import math
import os
import struct
from dataclasses import replace
from pathlib import Path
from typing import Any

from .errors import InvalidPackError
from .models import FilterInput, Hit, Pack, PackMeta, PackStats, QueryOptions
from .tokenize import normalize, tokenize

_UINT32 = struct.Struct("<I")
_MISSING = object()


def mount_pack(source: str | os.PathLike[str] | bytes | bytearray | memoryview) -> Pack:
    """Mount a pack from a local file path or a bytes-like object."""
    if isinstance(source, (bytes, bytearray, memoryview)):
        return mount_pack_from_bytes(source)

    path = Path(os.fspath(source))
    return mount_pack_from_bytes(path.read_bytes())


def mount_pack_from_bytes(data: bytes | bytearray | memoryview) -> Pack:
    """Mount a pack from a bytes-like object."""
    try:
        view = memoryview(data).cast("B")
    except TypeError as exc:  # pragma: no cover - defensive type guard
        raise TypeError("mount_pack_from_bytes() expects a bytes-like object") from exc

    offset = 0
    meta_payload, offset = _read_json_section(view, offset, "meta")
    meta = _parse_meta(meta_payload)

    lexicon_payload, offset = _read_json_section(view, offset, "lexicon")
    lexicon = _parse_lexicon(lexicon_payload)

    post_count, offset = _read_u32(view, offset)
    postings = tuple(_read_u32_array(view, offset, post_count))
    offset += post_count * 4

    blocks_payload, offset = _read_json_section(view, offset, "blocks")
    blocks, headings, doc_ids, namespaces, block_token_lens = _parse_blocks(blocks_payload)

    return Pack(
        meta=meta,
        lexicon=lexicon,
        postings=postings,
        blocks=blocks,
        headings=headings,
        doc_ids=doc_ids,
        namespaces=namespaces,
        block_token_lens=block_token_lens,
    )


def query(
    pack: Pack,
    q: str,
    options: QueryOptions | None = None,
    *,
    top_k: int | object = _MISSING,
    min_score: float | object = _MISSING,
    namespace: FilterInput | object = _MISSING,
    source: FilterInput | object = _MISSING,
) -> list[Hit]:
    """Run deterministic lexical retrieval over a mounted pack."""
    resolved = _merge_query_options(
        options,
        top_k=top_k,
        min_score=min_score,
        namespace=namespace,
        source=source,
    )
    _validate_query_options(resolved)

    if not q.strip():
        return []

    query_terms = tokenize(q)
    if not query_terms:
        return []

    term_ids = {pack.lexicon[term] for term in query_terms if term in pack.lexicon}
    if not term_ids:
        return []

    candidates, dfs = _scan_postings(pack, term_ids)
    if not candidates:
        return []

    namespace_filters = _normalize_filter_values(resolved.namespace)
    source_filters = _normalize_filter_values(resolved.source)
    if namespace_filters:
        candidates = {
            block_id: tf_map
            for block_id, tf_map in candidates.items()
            if _matches_filter(pack.namespaces, block_id, namespace_filters)
        }
    if not candidates:
        return []

    if source_filters:
        candidates = {
            block_id: tf_map
            for block_id, tf_map in candidates.items()
            if _matches_filter(pack.doc_ids, block_id, source_filters)
        }
    if not candidates:
        return []

    doc_count = max(pack.meta.stats.blocks, len(pack.blocks), 1)
    avg_len = _resolve_avg_block_len(pack)

    hits: list[Hit] = []
    for block_id, tf_map in candidates.items():
        block_len = _resolve_block_len(pack, block_id)
        score = 0.0
        for term_id, tf in tf_map.items():
            df = dfs.get(term_id, 0)
            idf = math.log(1.0 + (doc_count - df + 0.5) / (df + 0.5))
            k1 = 1.5
            b = 0.75
            numerator = tf * (k1 + 1.0)
            denominator = tf + k1 * (1.0 - b + b * (block_len / avg_len))
            score += idf * (numerator / denominator)

        if score < resolved.min_score:
            continue

        hits.append(
            Hit(
                block_id=block_id,
                score=score,
                text=pack.blocks[block_id] if block_id < len(pack.blocks) else "",
                source=pack.doc_ids[block_id] if block_id < len(pack.doc_ids) else None,
                namespace=pack.namespaces[block_id] if block_id < len(pack.namespaces) else None,
            )
        )

    hits.sort(key=lambda hit: (-hit.score, hit.block_id))
    return hits[: resolved.top_k]


def _merge_query_options(
    options: QueryOptions | None,
    *,
    top_k: int | object,
    min_score: float | object,
    namespace: FilterInput | object,
    source: FilterInput | object,
) -> QueryOptions:
    resolved = replace(options) if options is not None else QueryOptions()

    if top_k is not _MISSING:
        resolved.top_k = top_k  # type: ignore[assignment]
    if min_score is not _MISSING:
        resolved.min_score = min_score  # type: ignore[assignment]
    if namespace is not _MISSING:
        resolved.namespace = namespace  # type: ignore[assignment]
    if source is not _MISSING:
        resolved.source = source  # type: ignore[assignment]
    return resolved


def _validate_query_options(options: QueryOptions) -> None:
    if not _is_positive_int(options.top_k):
        raise ValueError("query(...): top_k must be a positive integer")
    if not _is_non_negative_finite_number(options.min_score):
        raise ValueError("query(...): min_score must be a finite number >= 0")


def _scan_postings(pack: Pack, term_ids: set[int]) -> tuple[dict[int, dict[int, int]], dict[int, int]]:
    candidates: dict[int, dict[int, int]] = {}
    dfs: dict[int, int] = {}
    uses_offset_block_ids = pack.meta.version >= 3
    postings = pack.postings
    cursor = 0

    while cursor < len(postings):
        term_id = postings[cursor]
        cursor += 1
        if term_id == 0:
            continue

        relevant = term_id in term_ids
        term_df = 0

        while True:
            if cursor >= len(postings):
                raise InvalidPackError("unexpected end of postings stream")

            encoded_block_id = postings[cursor]
            cursor += 1
            if encoded_block_id == 0:
                break

            block_id = encoded_block_id - 1 if uses_offset_block_ids else encoded_block_id
            tf = 0

            while True:
                if cursor >= len(postings):
                    raise InvalidPackError("unexpected end of postings stream")

                position = postings[cursor]
                cursor += 1
                if position == 0:
                    break
                tf += 1

            term_df += 1
            if relevant and 0 <= block_id < len(pack.blocks):
                tf_map = candidates.setdefault(block_id, {})
                tf_map[term_id] = tf_map.get(term_id, 0) + tf

        if relevant:
            dfs[term_id] = term_df

    return candidates, dfs


def _resolve_block_len(pack: Pack, block_id: int) -> int:
    if 0 <= block_id < len(pack.block_token_lens):
        length = pack.block_token_lens[block_id]
        if _is_int(length) and length >= 0:
            return length
    if 0 <= block_id < len(pack.blocks):
        return len(tokenize(pack.blocks[block_id]))
    return 1


def _resolve_avg_block_len(pack: Pack) -> float:
    avg = pack.meta.stats.avg_block_len
    if isinstance(avg, (int, float)) and math.isfinite(avg) and avg > 0:
        return float(avg)

    lengths = [
        _resolve_block_len(pack, index)
        for index in range(len(pack.blocks))
    ]
    if not lengths:
        return 1.0
    return max(sum(lengths) / len(lengths), 1.0)


def _normalize_filter_values(value: FilterInput) -> set[str]:
    if value is None:
        return set()
    if isinstance(value, str):
        values = [value]
    else:
        try:
            values = list(value)
        except TypeError as exc:
            raise ValueError("query(...): namespace/source filters must be strings or iterables of strings") from exc
    normalized: set[str] = set()
    for item in values:
        if not isinstance(item, str):
            raise ValueError("query(...): namespace/source filters must be strings or iterables of strings")
        item_norm = normalize(item)
        if item_norm:
            normalized.add(item_norm)
    return normalized


def _matches_filter(values: tuple[str | None, ...], block_id: int, filter_values: set[str]) -> bool:
    if not filter_values:
        return True
    if block_id >= len(values):
        return False
    value = values[block_id]
    return isinstance(value, str) and normalize(value) in filter_values


def _parse_meta(payload: Any) -> PackMeta:
    if not isinstance(payload, dict):
        raise InvalidPackError("meta must be a JSON object")

    version = _require_int(payload.get("version"), "meta.version", minimum=1)
    stats_payload = payload.get("stats")
    if not isinstance(stats_payload, dict):
        raise InvalidPackError("meta.stats must be a JSON object")

    docs = _require_int(stats_payload.get("docs"), "meta.stats.docs", minimum=0)
    blocks = _require_int(stats_payload.get("blocks"), "meta.stats.blocks", minimum=0)
    terms = _require_int(stats_payload.get("terms"), "meta.stats.terms", minimum=0)
    avg_block_len = stats_payload.get("avgBlockLen", stats_payload.get("avg_block_len"))
    if avg_block_len is not None:
        avg_block_len = _require_float(avg_block_len, "meta.stats.avgBlockLen", minimum=0.0)

    return PackMeta(
        version=version,
        stats=PackStats(
            docs=docs,
            blocks=blocks,
            terms=terms,
            avg_block_len=avg_block_len,
        ),
    )


def _parse_lexicon(payload: Any) -> dict[str, int]:
    lexicon: dict[str, int] = {}
    if isinstance(payload, dict):
        items = payload.items()
        for term, term_id in items:
            if not isinstance(term, str):
                raise InvalidPackError("lexicon keys must be strings")
            lexicon[term] = _require_int(term_id, f"lexicon[{term!r}]", minimum=1)
        return lexicon

    if not isinstance(payload, list):
        raise InvalidPackError("lexicon must be a JSON array or object")

    for entry in payload:
        if not isinstance(entry, list) or len(entry) != 2:
            raise InvalidPackError("lexicon entries must be [term, id] pairs")
        term, term_id = entry
        if not isinstance(term, str):
            raise InvalidPackError("lexicon terms must be strings")
        lexicon[term] = _require_int(term_id, f"lexicon[{term!r}]", minimum=1)

    return lexicon


def _parse_blocks(payload: Any) -> tuple[tuple[str, ...], tuple[str | None, ...], tuple[str | None, ...], tuple[str | None, ...], tuple[int, ...]]:
    if not isinstance(payload, list):
        raise InvalidPackError("blocks must be a JSON array")

    blocks: list[str] = []
    headings: list[str | None] = []
    doc_ids: list[str | None] = []
    namespaces: list[str | None] = []
    lengths: list[int] = []

    for item in payload:
        if isinstance(item, str):
            text = item
            heading = None
            doc_id = None
            namespace = None
            length = None
        elif isinstance(item, dict):
            text_value = item.get("text", "")
            text = text_value if isinstance(text_value, str) else ""
            heading = _optional_str(item.get("heading"))
            doc_id = _optional_str(item.get("docId"))
            namespace = _optional_str(item.get("namespace"))
            length = _optional_int(item.get("len"), minimum=0)
        else:
            text = "" if item is None else str(item)
            heading = None
            doc_id = None
            namespace = None
            length = None

        if length is None:
            length = len(tokenize(text))

        blocks.append(text)
        headings.append(heading)
        doc_ids.append(doc_id)
        namespaces.append(namespace)
        lengths.append(length)

    return (
        tuple(blocks),
        tuple(headings),
        tuple(doc_ids),
        tuple(namespaces),
        tuple(lengths),
    )


def _read_json_section(view: memoryview, offset: int, name: str) -> tuple[Any, int]:
    length, offset = _read_u32(view, offset)
    if offset + length > len(view):
        raise InvalidPackError(f"{name} section is truncated")

    raw = bytes(view[offset : offset + length])
    offset += length

    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise InvalidPackError(f"{name} section is not valid UTF-8") from exc

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise InvalidPackError(f"{name} section is not valid JSON") from exc

    return payload, offset


def _read_u32(view: memoryview, offset: int) -> tuple[int, int]:
    if offset + 4 > len(view):
        raise InvalidPackError("unexpected end of buffer")
    try:
        (value,) = _UINT32.unpack_from(view, offset)
    except struct.error as exc:  # pragma: no cover - defensive
        raise InvalidPackError("unexpected end of buffer") from exc
    return value, offset + 4


def _read_u32_array(view: memoryview, offset: int, length: int) -> list[int]:
    if length > (len(view) - offset) // 4:
        raise InvalidPackError("unexpected end of buffer")
    values: list[int] = []
    for _ in range(length):
        value, offset = _read_u32(view, offset)
        values.append(value)
    return values


def _optional_str(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def _optional_int(value: Any, *, minimum: int | None = None) -> int | None:
    if not _is_int(value):
        return None
    if minimum is not None and value < minimum:
        return None
    return value


def _require_int(value: Any, field_name: str, *, minimum: int | None = None) -> int:
    if not _is_int(value):
        raise InvalidPackError(f"{field_name} must be an integer")
    if minimum is not None and value < minimum:
        raise InvalidPackError(f"{field_name} must be >= {minimum}")
    return value


def _require_float(value: Any, field_name: str, *, minimum: float | None = None) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InvalidPackError(f"{field_name} must be a number")
    out = float(value)
    if not math.isfinite(out):
        raise InvalidPackError(f"{field_name} must be finite")
    if minimum is not None and out < minimum:
        raise InvalidPackError(f"{field_name} must be >= {minimum}")
    return out


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_positive_int(value: Any) -> bool:
    return _is_int(value) and value > 0


def _is_non_negative_finite_number(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    out = float(value)
    return math.isfinite(out) and out >= 0
