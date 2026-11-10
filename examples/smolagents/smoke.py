"""List Knolo tools through smolagents and run one search. No model call."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from smolagents import ToolCollection

import server

EXPECTED_TOOLS = [
    "knolo_get",
    "knolo_search",
    "knolo_status",
    "knolo_verify",
]
GRAPH_TOOLS = [
    "knolo_cortex_verify",
    "knolo_kar_evaluate",
    "knolo_kar_verify",
]


def blocked_config(config_path: Path) -> Path:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    blocker = config_path.parent / "not-a-directory"
    blocker.write_text("blocked", encoding="utf-8")
    config["auditDir"] = str(blocker / "audit")
    blocked = config_path.parent / "knolo-mcp-blocked.json"
    blocked.write_text(json.dumps(config), encoding="utf-8")
    return blocked


def search_body(result: object) -> dict:
    if isinstance(result, dict) and isinstance(result.get("hits"), list):
        return result
    text = result if isinstance(result, str) else json.dumps(result, default=str)
    parsed = json.loads(text)
    if isinstance(parsed, dict) and isinstance(parsed.get("hits"), list):
        return parsed
    content = parsed.get("content") if isinstance(parsed, dict) else None
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and isinstance(block.get("text"), str):
                body = json.loads(block["text"])
                if isinstance(body, dict):
                    return body
    raise SystemExit(f"search result has no hits: {text}")


def assert_search(config_path: Path) -> tuple[list[str], str, str]:
    with ToolCollection.from_mcp(
        server.server_parameters(config_path),
        trust_remote_code=True,
        structured_output=False,
    ) as collection:
        names = sorted(tool.name for tool in collection.tools)
        if names != EXPECTED_TOOLS:
            raise SystemExit(f"tools {names}")
        for graph_tool in GRAPH_TOOLS:
            if graph_tool in names:
                raise SystemExit(f"unexpected graph tool {graph_tool}")
        search = next(tool for tool in collection.tools if tool.name == "knolo_search")
        body = search_body(search(query="enterprise refunds", limit=4))
        hits = body.get("hits")
        receipts = body.get("receipts")
        if not isinstance(hits, list) or len(hits) != 1:
            raise SystemExit(f"hits {hits!r}")
        hit = hits[0]
        excerpt = str(hit.get("excerpt", ""))
        if "Annual enterprise refunds" not in excerpt:
            raise SystemExit(f"excerpt {excerpt!r}")
        object_id = hit.get("objectId")
        state_root = hit.get("stateRoot")
        if not isinstance(object_id, str) or not object_id:
            raise SystemExit(f"objectId {object_id!r}")
        if not isinstance(state_root, str) or not state_root.startswith("sha256-"):
            raise SystemExit(f"stateRoot {state_root!r}")
        if not isinstance(receipts, list) or not receipts:
            raise SystemExit("missing receipt")
        receipt_id = receipts[0].get("receiptId")
        if not isinstance(receipt_id, str) or not receipt_id.startswith("qr_"):
            raise SystemExit(f"receiptId {receipt_id!r}")
        return names, excerpt, receipt_id


def assert_audit_unavailable(config_path: Path) -> None:
    with ToolCollection.from_mcp(
        server.server_parameters(blocked_config(config_path)),
        trust_remote_code=True,
        structured_output=False,
    ) as collection:
        search = next(tool for tool in collection.tools if tool.name == "knolo_search")
        try:
            result = search(query="refunds", limit=1)
        except Exception as error:
            text = str(error)
        else:
            text = result if isinstance(result, str) else json.dumps(result, default=str)
        if "AUDIT_UNAVAILABLE" not in text:
            raise SystemExit(f"audit error {text}")


def main() -> None:
    config_path = server.mcp_config_path()
    if config_path is None:
        raise SystemExit("Set KNOLO_MCP_CONFIG to an absolute knolo-mcp.json path.")
    names, excerpt, receipt_id = assert_search(config_path)
    assert_audit_unavailable(config_path)
    json.dump(
        {
            "tools": names,
            "excerpt": excerpt,
            "receiptId": receipt_id,
            "modelCalled": False,
        },
        sys.stdout,
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
