"""List Knolo tools through Pydantic AI and run one search. No model call."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

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


async def assert_audit_unavailable(config_path: Path) -> None:
    toolset = server.knolo_toolset(blocked_config(config_path))
    async with toolset:
        try:
            result = await toolset.direct_call_tool(
                "knolo_search",
                {"query": "refunds", "limit": 1},
            )
        except Exception as error:
            text = str(error)
        else:
            text = json.dumps(result, default=str)
        if "AUDIT_UNAVAILABLE" not in text:
            raise SystemExit(f"audit error {text}")


def search_body(result: object) -> dict:
    if not isinstance(result, dict):
        raise SystemExit(f"search returned {type(result).__name__}")
    if result.get("isError") or result.get("is_error"):
        raise SystemExit(json.dumps(result))
    if isinstance(result.get("hits"), list):
        return result
    body = result.get("structuredContent")
    if not isinstance(body, dict):
        content = result.get("content")
        text = None
        if isinstance(content, list) and content and isinstance(content[0], dict):
            text = content[0].get("text")
        if isinstance(text, str):
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                body = parsed
    if not isinstance(body, dict):
        raise SystemExit("search result has no structured body")
    return body


async def main() -> None:
    config_path = server.mcp_config_path()
    if config_path is None:
        raise SystemExit(
            "Set KNOLO_MCP_CONFIG to an absolute knolo-mcp.json path."
        )
    toolset = server.knolo_toolset(config_path)
    async with toolset:
        tools = await toolset.list_tools()
        names = sorted(tool.name for tool in tools)
        if names != EXPECTED_TOOLS:
            raise SystemExit(f"tools {names}")
        for graph_tool in GRAPH_TOOLS:
            if graph_tool in names:
                raise SystemExit(f"unexpected graph tool {graph_tool}")
        result = await toolset.direct_call_tool(
            "knolo_search",
            {"query": "enterprise refunds", "limit": 4},
        )
        body = search_body(result)
        hits = body.get("hits")
        receipts = body.get("receipts")
        if not isinstance(hits, list) or len(hits) != 1:
            raise SystemExit(f"hits {hits!r}")
        hit = hits[0]
        if not isinstance(hit, dict):
            raise SystemExit(f"hit {hit!r}")
        excerpt = hit.get("excerpt", "")
        if "Annual enterprise refunds" not in str(excerpt):
            raise SystemExit(f"excerpt {excerpt!r}")
        object_id = hit.get("objectId")
        state_root = hit.get("stateRoot")
        if not isinstance(object_id, str) or not object_id:
            raise SystemExit(f"objectId {object_id!r}")
        if not isinstance(state_root, str) or not state_root.startswith("sha256-"):
            raise SystemExit(f"stateRoot {state_root!r}")
        if not isinstance(receipts, list) or not receipts:
            raise SystemExit("missing receipt")
        receipt_row = receipts[0]
        if not isinstance(receipt_row, dict):
            raise SystemExit(f"receipt {receipt_row!r}")
        receipt_id = receipt_row.get("receiptId")
        if not isinstance(receipt_id, str) or not receipt_id.startswith("qr_"):
            raise SystemExit(f"receiptId {receipt_id!r}")
        if receipt_row.get("stateRoot") != state_root:
            raise SystemExit(f"receipt stateRoot {receipt_row.get('stateRoot')!r}")
        config = json.loads(config_path.read_text(encoding="utf-8"))
        receipt_path = Path(config["auditDir"]) / f"{receipt_id}.json"
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        if receipt.get("version") != "openclaw-knolo-query-v1":
            raise SystemExit(f"receipt version {receipt.get('version')!r}")
        await assert_audit_unavailable(config_path)
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
    asyncio.run(main())
