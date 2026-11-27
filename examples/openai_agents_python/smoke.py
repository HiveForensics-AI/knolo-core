"""List Knolo tools through the OpenAI Agents SDK and run one search.

No model call.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from agents import set_tracing_disabled

import server

EXPECTED_TOOLS = [
    "knolo_get",
    "knolo_search",
    "knolo_status",
    "knolo_verify",
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
    if getattr(result, "is_error", False):
        raise SystemExit(f"search error {getattr(result, 'content', result)!r}")
    body = getattr(result, "structured_content", None)
    if not isinstance(body, dict):
        raise SystemExit("search result has no structured body")
    return body


def error_text(result: object) -> str:
    content = getattr(result, "content", None)
    block = content[0] if isinstance(content, list) and content else None
    text = getattr(block, "text", None)
    if not isinstance(text, str):
        raise SystemExit(f"audit error {result!r}")
    return text


async def assert_audit_unavailable(config_path: Path) -> None:
    blocked = server.knolo_server(blocked_config(config_path))
    async with blocked:
        result = await blocked.call_tool(
            "knolo_search",
            {"query": "refunds", "limit": 1},
        )
        text = error_text(result)
        if not result.is_error or not text.startswith("AUDIT_UNAVAILABLE:"):
            raise SystemExit(f"audit error {text}")


async def main() -> None:
    set_tracing_disabled(True)
    config_path = server.mcp_config_path()
    if config_path is None:
        raise SystemExit(
            "Set KNOLO_MCP_CONFIG to an absolute knolo-mcp.json path."
        )
    knolo = server.knolo_server(config_path)
    async with knolo:
        tools = await knolo.list_tools()
        names = sorted(tool.name for tool in tools)
        if names != EXPECTED_TOOLS:
            raise SystemExit(f"tools {names}")
        result = await knolo.call_tool(
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
            raise SystemExit(
                f"receipt stateRoot {receipt_row.get('stateRoot')!r}"
            )
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
