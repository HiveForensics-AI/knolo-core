"""List Knolo tools through CrewAI and run one search. No model call."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

os.environ.setdefault("CREWAI_DISABLE_TELEMETRY", "true")
os.environ.setdefault("CREWAI_TRACING_ENABLED", "false")

from crewai_tools import MCPServerAdapter

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


def as_text(value: object) -> str:
    if isinstance(value, str):
        return value
    content = getattr(value, "content", None)
    if isinstance(content, str):
        return content
    return json.dumps(value, default=str)


def search_body(result: object) -> dict:
    text = as_text(result)
    parsed = json.loads(text) if text.startswith("{") else None
    if isinstance(parsed, dict) and isinstance(parsed.get("hits"), list):
        return parsed
    if isinstance(result, dict) and isinstance(result.get("hits"), list):
        return result
    raise SystemExit(f"search result has no hits: {text}")


def tool_named(tools: object, name: str):
    for tool in tools:  # type: ignore[union-attr]
        if getattr(tool, "name", None) == name:
            return tool
    raise SystemExit(f"missing tool {name}")


def assert_search(config_path: Path) -> tuple[list[str], str, str]:
    with MCPServerAdapter(
        server.server_parameters(config_path),
        connect_timeout=60,
    ) as tools:
        names = sorted(tool.name for tool in tools)
        if names != EXPECTED_TOOLS:
            raise SystemExit(f"tools {names}")
        for graph_tool in GRAPH_TOOLS:
            if graph_tool in names:
                raise SystemExit(f"unexpected graph tool {graph_tool}")
        result = tool_named(tools, "knolo_search").run(
            query="enterprise refunds",
            limit=4,
        )
        body = search_body(result)
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
    with MCPServerAdapter(
        server.server_parameters(blocked_config(config_path)),
        connect_timeout=60,
    ) as tools:
        result = tool_named(tools, "knolo_search").run(query="refunds", limit=1)
        text = as_text(result)
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
