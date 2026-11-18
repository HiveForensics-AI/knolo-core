"""List Knolo tools through Agent Framework and run search and verify.

No model call.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from pathlib import Path

import agent

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


def bad_pin_config(config_path: Path) -> Path:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    config["mounts"][0]["sha256"] = "c" * 64
    bad = config_path.parent / "knolo-mcp-bad-pin.json"
    bad.write_text(json.dumps(config), encoding="utf-8")
    return bad


def as_text(result: object) -> str:
    if isinstance(result, str):
        return result
    if not isinstance(result, list):
        raise SystemExit(f"tool returned {type(result).__name__}")
    parts: list[str] = []
    for item in result:
        text = getattr(item, "text", None)
        if isinstance(text, str):
            parts.append(text)
        elif isinstance(item, dict) and isinstance(item.get("text"), str):
            parts.append(item["text"])
    if not parts:
        raise SystemExit(f"tool returned {result!r}")
    return "\n".join(parts)


def tool_body(result: object) -> dict:
    text = as_text(result)
    if "AUDIT_UNAVAILABLE" in text or text.startswith("IMAGE_INVALID"):
        return {"error": text}
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise SystemExit(f"tool JSON was {type(parsed).__name__}")
    return parsed


async def assert_audit_unavailable(config_path: Path) -> None:
    async with agent.knolo_tool(blocked_config(config_path)) as tool:
        try:
            result = await tool.call_tool(
                "knolo_search", query="refunds", limit=1
            )
        except Exception as error:
            text = str(error)
        else:
            text = as_text(result)
        if "AUDIT_UNAVAILABLE" not in text:
            raise SystemExit(f"audit error {text}")


def assert_bad_pin_exits(config_path: Path) -> None:
    command, args = agent.server_command()
    completed = subprocess.run(
        [command, *args, "--config", str(bad_pin_config(config_path))],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if completed.returncode == 0:
        raise SystemExit("bad pin exited 0")
    if "IMAGE_INVALID" not in completed.stderr:
        raise SystemExit(completed.stderr or completed.stdout)
    if "serving stdio" in completed.stderr:
        raise SystemExit("server served tools after a bad pin")


async def main() -> None:
    config_path = agent.mcp_config_path()
    if config_path is None:
        raise SystemExit(
            "Set KNOLO_MCP_CONFIG to an absolute knolo-mcp.json path."
        )
    async with agent.knolo_tool(config_path) as tool:
        names = sorted(item.name for item in tool.functions)
        if names != EXPECTED_TOOLS:
            raise SystemExit(f"tools {names}")
        search = await tool.call_tool(
            "knolo_search", query="enterprise refunds", limit=4
        )
        body = tool_body(search)
        hits = body.get("hits")
        receipts = body.get("receipts")
        if not isinstance(hits, list) or len(hits) != 1:
            raise SystemExit(f"hits {hits!r}")
        excerpt = hits[0].get("excerpt", "")
        object_id = hits[0].get("objectId")
        if "Annual enterprise refunds" not in str(excerpt):
            raise SystemExit(f"excerpt {excerpt!r}")
        if not isinstance(object_id, str) or not object_id:
            raise SystemExit(f"objectId {object_id!r}")
        if not isinstance(receipts, list) or not receipts:
            raise SystemExit("missing receipt")
        receipt_id = receipts[0].get("receiptId")
        if not isinstance(receipt_id, str) or not receipt_id:
            raise SystemExit("missing receiptId")
        config = json.loads(config_path.read_text(encoding="utf-8"))
        receipt_path = Path(config["auditDir"]) / f"{receipt_id}.json"
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        if receipt.get("version") != "openclaw-knolo-query-v1":
            raise SystemExit(f"receipt version {receipt.get('version')!r}")
        verified = tool_body(await tool.call_tool("knolo_verify"))
        results = verified.get("results")
        if not isinstance(results, list) or not results:
            raise SystemExit(f"verify {verified!r}")
        if results[0].get("valid") is not True:
            raise SystemExit(f"verify {results[0]!r}")
        await assert_audit_unavailable(config_path)
        assert_bad_pin_exits(config_path)
        json.dump(
            {
                "tools": names,
                "excerpt": excerpt,
                "objectId": object_id,
                "receiptId": receipt_id,
                "verified": True,
                "modelCalled": False,
            },
            sys.stdout,
        )
        sys.stdout.write("\n")


if __name__ == "__main__":
    asyncio.run(main())
