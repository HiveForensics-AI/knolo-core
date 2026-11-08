"""List Knolo tools over stdio and run one search. No model call.

Dify's built-in MCP client accepts an http or https URL. This smoke starts
the stdio server with the MCP Python SDK. It does not start Dify and it
does not listen on a port.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from mcp import Client, StdioServerParameters

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

MCP_PATH = Path(__file__).with_name("mcp.json")


def _text_payload(result: object) -> dict | None:
    content = getattr(result, "content", None)
    if not isinstance(content, list) or not content:
        return None
    block = content[0]
    text = getattr(block, "text", None)
    if not isinstance(text, str):
        return None
    parsed = json.loads(text)
    return parsed if isinstance(parsed, dict) else None


def search_body(result: object) -> dict:
    is_error = bool(getattr(result, "is_error", False) or getattr(result, "isError", False))
    structured = getattr(result, "structured_content", None)
    if structured is None:
        structured = getattr(result, "structuredContent", None)
    if is_error:
        payload = _text_payload(result)
        detail = json.dumps(payload) if payload is not None else "search tool returned an error"
        raise SystemExit(detail[:500])
    if isinstance(structured, dict) and isinstance(structured.get("hits"), list):
        return structured
    parsed = _text_payload(result)
    if isinstance(parsed, dict):
        return parsed
    raise SystemExit("search result has no structured body")


def assert_search(config_path: Path, body: dict) -> tuple[str, str]:
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
    return str(excerpt), receipt_id


async def main() -> None:
    config_path = server.mcp_config_path()
    if config_path is None:
        raise SystemExit("Set KNOLO_MCP_CONFIG to an absolute knolo-mcp.json path.")
    saved = json.loads(MCP_PATH.read_text(encoding="utf-8"))
    if saved != server.published_mcp_config():
        raise SystemExit("mcp.json does not match the published pin")
    command, args = server.command_args(config_path)
    parameters = StdioServerParameters(command=command, args=args)
    async with Client(parameters) as client:
        listed = await client.list_tools()
        if listed.next_cursor is not None:
            raise SystemExit("tool list is paged")
        names = sorted(tool.name for tool in listed.tools)
        if names != EXPECTED_TOOLS:
            raise SystemExit(f"tools {names}")
        for graph_tool in GRAPH_TOOLS:
            if graph_tool in names:
                raise SystemExit(f"unexpected graph tool {graph_tool}")
        result = await client.call_tool(
            "knolo_search",
            {"query": "enterprise refunds", "limit": 4},
        )
        excerpt, receipt_id = assert_search(config_path, search_body(result))

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
