"""List Knolo tools through ADK and run one search. No model call."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

import agent

EXPECTED_TOOLS = [
    "knolo_get",
    "knolo_search",
    "knolo_status",
    "knolo_verify",
]


def search_body(result: object) -> dict:
    if not isinstance(result, dict):
        raise SystemExit(f"search returned {type(result).__name__}")
    if result.get("isError") or result.get("is_error"):
        raise SystemExit(json.dumps(result))
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
    if agent.root_agent is None:
        raise SystemExit(
            "Set KNOLO_MCP_CONFIG to an absolute knolo-mcp.json path."
        )
    toolset = agent.root_agent.tools[0]
    try:
        tools = await toolset.get_tools(readonly_context=None)
        names = sorted(tool.name for tool in tools)
        if names != EXPECTED_TOOLS:
            raise SystemExit(f"tools {names}")
        search = next(tool for tool in tools if tool.name == "knolo_search")
        result = await search.run_async(
            args={"query": "enterprise refunds", "limit": 4},
            tool_context=None,
        )
        body = search_body(result)
        hits = body.get("hits")
        receipts = body.get("receipts")
        if not isinstance(hits, list) or len(hits) != 1:
            raise SystemExit(f"hits {hits!r}")
        excerpt = hits[0].get("excerpt", "")
        if "Annual enterprise refunds" not in str(excerpt):
            raise SystemExit(f"excerpt {excerpt!r}")
        if not isinstance(receipts, list) or not receipts:
            raise SystemExit("missing receipt")
        receipt_id = receipts[0].get("receiptId")
        if not isinstance(receipt_id, str) or not receipt_id:
            raise SystemExit("missing receiptId")
        config_path = os.environ["KNOLO_MCP_CONFIG"]
        config = json.loads(Path(config_path).read_text(encoding="utf-8"))
        receipt_path = Path(config["auditDir"]) / f"{receipt_id}.json"
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        if receipt.get("version") != "openclaw-knolo-query-v1":
            raise SystemExit(f"receipt version {receipt.get('version')!r}")
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
    finally:
        await toolset.close()


if __name__ == "__main__":
    asyncio.run(main())
