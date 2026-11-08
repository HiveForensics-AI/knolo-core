"""Load the Knolo Langflow flow and run one search. No model call."""

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

FLOW_PATH = Path(__file__).with_name("flow.json")


def node_by_id(flow: dict, component_id: str) -> dict:
    for node in flow.get("data", {}).get("nodes", []):
        if node.get("id") == component_id:
            return node
    raise SystemExit(f"missing component {component_id}")


def template_value(flow: dict, component_id: str, field_name: str):
    node = node_by_id(flow, component_id)
    field = node.get("data", {}).get("node", {}).get("template", {}).get(field_name)
    if not isinstance(field, dict):
        raise SystemExit(f"missing field {component_id}.{field_name}")
    return field.get("value")


def assert_published_flow(flow: dict) -> None:
    if flow.get("name") != "Knolo":
        raise SystemExit(f"flow name {flow.get('name')!r}")
    published = server.published_stdio_value()
    mcp_server = template_value(flow, "MCPTools-knolo", "mcp_server")
    if mcp_server != published:
        raise SystemExit("MCP server value does not match the published pin")
    if template_value(flow, "MCPTools-knolo", "use_cache") is not False:
        raise SystemExit("use_cache must stay false")
    if template_value(flow, "MCPTools-knolo", "tool") not in ("", None):
        raise SystemExit("tool must stay blank so every tool is listed")
    instructions = template_value(flow, "Agent-knolo", "system_prompt")
    if instructions != server.AGENT_INSTRUCTIONS:
        raise SystemExit("agent instructions drifted")
    if template_value(flow, "Agent-knolo", "api_key"):
        raise SystemExit("agent api key must stay empty")
    model = template_value(flow, "Agent-knolo", "model")
    if model:
        raise SystemExit("agent model must stay empty")
    expected_edges = {
        ("ChatInput-knolo", "message", "Agent-knolo", "input_value"),
        ("Agent-knolo", "response", "ChatOutput-knolo", "input_value"),
        ("MCPTools-knolo", "component_as_tool", "Agent-knolo", "tools"),
    }
    found = set()
    for edge in flow.get("data", {}).get("edges", []):
        source_handle = (edge.get("data") or {}).get("sourceHandle") or {}
        target_handle = (edge.get("data") or {}).get("targetHandle") or {}
        found.add(
            (
                edge.get("source"),
                source_handle.get("name"),
                edge.get("target"),
                target_handle.get("fieldName"),
            )
        )
    if found != expected_edges:
        raise SystemExit(f"edges {sorted(found)!r}")


def _text_payload(result: object) -> dict | None:
    content = result.get("content") if isinstance(result, dict) else getattr(result, "content", None)
    if not isinstance(content, list) or not content:
        return None
    block = content[0]
    text = block.get("text") if isinstance(block, dict) else getattr(block, "text", None)
    if not isinstance(text, str):
        return None
    parsed = json.loads(text)
    return parsed if isinstance(parsed, dict) else None


def search_body(result: object) -> dict:
    if isinstance(result, dict):
        is_error = bool(result.get("isError") or result.get("is_error"))
        if isinstance(result.get("hits"), list):
            if is_error:
                raise SystemExit("search tool returned an error")
            return result
        structured = result.get("structuredContent") or result.get("structured_content")
    else:
        is_error = bool(getattr(result, "isError", False) or getattr(result, "is_error", False))
        structured = getattr(result, "structuredContent", None)
        if structured is None:
            structured = getattr(result, "structured_content", None)
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
    flow = json.loads(FLOW_PATH.read_text(encoding="utf-8"))
    assert_published_flow(flow)

    from lfx.components.models_and_agents.mcp_component import MCPToolsComponent
    from lfx.graph.graph.base import Graph
    from lfx.services.deps import get_settings_service
    from lfx.services.initialize import initialize_services

    graph = Graph.from_payload(json.loads(json.dumps(flow)), flow_name="Knolo")
    if len(graph.vertices) != 4:
        raise SystemExit(f"vertices {len(graph.vertices)}")

    initialize_services()
    settings = get_settings_service()
    if settings is None or getattr(settings, "settings", None) is None:
        raise SystemExit("Langflow settings service is not available.")

    component = MCPToolsComponent()
    try:
        tools, _server_value = await component.update_tool_list(
            mcp_server_value=server.stdio_server_value(config_path)
        )
        names = sorted(tool.name for tool in tools)
        if names != EXPECTED_TOOLS:
            raise SystemExit(f"tools {names}")
        for graph_tool in GRAPH_TOOLS:
            if graph_tool in names:
                raise SystemExit(f"unexpected graph tool {graph_tool}")
        result = await component.stdio_client.run_tool(
            "knolo_search",
            {"query": "enterprise refunds", "limit": 4},
        )
        excerpt, receipt_id = assert_search(config_path, search_body(result))
    finally:
        await component.stdio_client.disconnect()

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
