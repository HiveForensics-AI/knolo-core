"""Public KAR v1 and KITE v1 vectors on the Python evaluator."""

from __future__ import annotations

import json
from pathlib import Path

from knolo import (
    create_kar_dossier_v5,
    derive_kite_world,
    evaluate_kar_v5,
    replay_kite_certificate,
    verify_kar_dossier_v5,
    verify_kar_v5,
)
from knolo.jsoncanon import canonicalize, parse_json, stringify
from knolo.kite import certificate_json

ROOT = Path(__file__).resolve().parents[3]
KAR_CASES = ROOT / "packages/core-rust/tests/fixtures/kar-v1/cases.json"
KAR_EXPECTED = ROOT / "conformance/kar/v1/expected.json"
KITE_CASES = ROOT / "packages/core-rust/tests/fixtures/kite-v1/cases.json"
KITE_EXPECTED = ROOT / "conformance/kite/v1/expected.json"
KITE_PUBLIC_WORLDS = (
    Path(__file__).resolve().parent / "fixtures" / "kite-public-worlds.json"
)


def test_public_kar_v1_vectors_match() -> None:
    manifest = json.loads(KAR_CASES.read_text(encoding="utf-8"))
    expected = json.loads(KAR_EXPECTED.read_text(encoding="utf-8"))
    assert expected["format"] == "kar-conformance-v1"
    assert len(manifest["cases"]) + 2 == len(expected["vectors"])
    actual = []
    support = None
    for case in manifest["cases"]:
        image = bytes.fromhex(case["imageHex"])
        sidecar = json.dumps(case["sidecar"], separators=(",", ":"))
        plan = json.dumps(case["plan"], separators=(",", ":"))
        proposition = case["proposition"]
        evaluation = evaluate_kar_v5(image, sidecar, proposition, plan)
        again = evaluate_kar_v5(image, sidecar, proposition, plan)
        assert evaluation.json == again.json
        verdict = verify_kar_v5(image, sidecar, proposition, plan, evaluation.json)
        assert verdict.ok, f"{case['id']} {verdict.code} {verdict.reason}"
        frontier = case.get("frontier")
        if not isinstance(frontier, str):
            frontier = None
        frontier_count = 0
        if frontier is not None:
            frontier_count = next(
                (len(ids) for name, ids in evaluation.frontiers if name == frontier),
                0,
            )
        record = {
            "id": case["id"],
            "status": evaluation.status,
            "code": evaluation.code,
            "verified": True,
        }
        if frontier is not None:
            record["frontier"] = frontier
        record.update(
            {
                "frontierCount": frontier_count,
                "selected": evaluation.selected_len,
                "karRoot": evaluation.kar_root,
                "knowledgeRoot": evaluation.knowledge_root,
                "semanticRoot": evaluation.semantic_root,
                "anchorMode": evaluation.anchor_mode or "",
            }
        )
        actual.append(record)
        if case["id"] == "support":
            support = (image, sidecar, plan, proposition, evaluation)
    assert support is not None
    image, sidecar, plan, proposition, evaluation = support
    tampered = _tamper_kar_root(evaluation.json)
    tamper = verify_kar_v5(image, sidecar, proposition, plan, tampered)
    actual.append(
        {
            "id": "tamper-rejection",
            "status": evaluation.status,
            "verifyOk": tamper.ok,
            "verifyCode": None if tamper.ok else tamper.code,
            "karRoot": evaluation.kar_root,
        }
    )
    dossier = create_kar_dossier_v5(image, sidecar, proposition, plan)
    dossier_again = create_kar_dossier_v5(image, sidecar, proposition, plan)
    assert dossier.manifest_json == dossier_again.manifest_json
    assert dossier.markdown == dossier_again.markdown
    honest = verify_kar_dossier_v5(
        image,
        sidecar,
        proposition,
        plan,
        dossier.manifest_json,
        dossier.certificate_json,
        dossier.evaluation_json,
        dossier.markdown,
    )
    assert honest.ok, f"{honest.code} {honest.reason}"
    tampered_markdown = dossier.markdown.replace(
        "Evidence requirements satisfied", "Claim proven", 1
    )
    markdown = verify_kar_dossier_v5(
        image,
        sidecar,
        proposition,
        plan,
        dossier.manifest_json,
        dossier.certificate_json,
        dossier.evaluation_json,
        tampered_markdown,
    )
    actual.append(
        {
            "id": "dossier-language-tamper",
            "statusStatement": dossier.status_statement,
            "verifyOk": markdown.ok,
            "verifyCode": None if markdown.ok else markdown.code,
        }
    )
    assert len(actual) == len(expected["vectors"])
    for index, (left, right) in enumerate(zip(expected["vectors"], actual)):
        assert canonicalize(parse_json(json.dumps(left))) == canonicalize(
            parse_json(json.dumps(right))
        ), f"vector {index} {left['id']}"


def test_kite_v1_vectors_replay() -> None:
    parsed = parse_json(KITE_CASES.read_text(encoding="utf-8"))
    assert parsed.get("format") is not None and parsed.get("format").as_str() == "kite-replay-v1"
    cases = parsed.get("cases").as_array()
    assert cases is not None and len(cases) >= 8
    for case in cases:
        case_id = case.get("id").as_str()
        world = case.get("world")
        expected = case.get("expected")
        assert world is not None and expected is not None and case_id
        world_text = stringify(world)
        derived = derive_kite_world(world_text)
        assert derived.verdict == expected.get("verdict").as_str(), case_id
        assert derived.base_world == (
            expected.get("baseWorld").as_str() if expected.get("baseWorld") else None
        ), case_id
        assert derived.agrees is bool(expected.get("agrees").value), case_id
        assert derived.worlds_checked == expected.get("worldsChecked").as_int(), case_id
        root = expected.get("invarianceRoot")
        assert derived.invariance_root == (None if root is None or root.kind == "null" else root.as_str())
        assert derived.obligation_ids == _strings(expected, "obligationIds"), case_id
        assert derived.met == _strings(expected, "met"), case_id
        assert derived.unmet == _strings(expected, "unmet"), case_id
        assert derived.source_partitions == _strings(expected, "sourcePartitions"), case_id
        if derived.verdict == "BOUND_EXCEEDED":
            rejected = replay_kite_certificate(
                world_text, '{"format":"knolo-kite-certificate-1"}'
            )
            assert not rejected.ok, case_id
        else:
            certificate = certificate_json(derived)
            verified = replay_kite_certificate(world_text, certificate)
            assert verified.ok, f"{case_id} {verified.message}"
            if derived.verdict != "WARRANTED_IN_SCOPE":
                tampered = certificate.replace(
                    f'"verdict":"{derived.verdict}"',
                    '"verdict":"WARRANTED_IN_SCOPE"',
                    1,
                )
                rejected = replay_kite_certificate(world_text, tampered)
                assert not rejected.ok, case_id


def test_kite_public_worlds_match_expected_roots() -> None:
    """Replay the worlds behind conformance/kite/v1.

    Those worlds come from the TypeScript image search. The Rust snapshot
    fixtures are a different input and lock different invariance roots.
    """
    worlds = json.loads(KITE_PUBLIC_WORLDS.read_text(encoding="utf-8"))
    assert worlds["format"] == "kite-public-worlds-1"
    public_cases = json.loads(KITE_EXPECTED.read_text(encoding="utf-8"))["cases"]
    public = {item["id"]: item for item in public_cases}
    assert [item["id"] for item in worlds["cases"]] == [item["id"] for item in public_cases]
    for case in worlds["cases"]:
        case_id = case["id"]
        row = public[case_id]
        derived = derive_kite_world(json.dumps(case["world"]))
        assert derived.verdict == row["verdict"], case_id
        assert derived.unmet == row["unmet"], case_id
        assert derived.invariance_root == row["invarianceRoot"], case_id


def _strings(value, key: str) -> list[str]:
    array = value.get(key).as_array()
    return [item.as_str() for item in array]


def _tamper_kar_root(evaluation_json: str) -> str:
    value = parse_json(evaluation_json)
    root = value.get("certificate").get("roots").get("karRoot")
    text = root.as_str()
    assert text
    chars = list(text)
    chars[-1] = "1" if chars[-1] == "0" else "0"
    root.value = "".join(chars)
    return stringify(value)
