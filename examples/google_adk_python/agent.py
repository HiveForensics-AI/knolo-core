"""One Google ADK agent that searches a pinned Knolo image over MCP stdio.

The host owns the model. Importing this module does not call one. `root_agent`
is set only when `KNOLO_MCP_CONFIG` is an absolute path, so a bare import does
not start the server.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from google.adk.agents.llm_agent import LlmAgent
from google.adk.tools.mcp_tool.mcp_session_manager import StdioConnectionParams
from google.adk.tools.mcp_tool.mcp_toolset import McpToolset
from mcp import StdioServerParameters

PUBLISHED_PACKAGE = "@knolo/mcp@0.2.3"


def mcp_config_path() -> Path | None:
    raw = os.environ.get("KNOLO_MCP_CONFIG", "").strip()
    if not raw:
        return None
    path = Path(raw)
    if not path.is_absolute():
        raise ValueError("KNOLO_MCP_CONFIG must be an absolute path.")
    return path


def connection_params(config: Path) -> StdioConnectionParams:
    command = os.environ.get("KNOLO_MCP_COMMAND", "npx")
    raw_args = os.environ.get("KNOLO_MCP_ARGS")
    if raw_args is None:
        args = ["-y", PUBLISHED_PACKAGE]
    else:
        parsed = json.loads(raw_args)
        if not isinstance(parsed, list) or not all(
            isinstance(item, str) for item in parsed
        ):
            raise ValueError("KNOLO_MCP_ARGS must be a JSON array of strings.")
        args = list(parsed)
    return StdioConnectionParams(
        server_params=StdioServerParameters(
            command=command,
            args=[*args, "--config", str(config)],
        ),
        timeout=60,
    )


def knolo_toolset(config: Path | None = None) -> McpToolset:
    resolved = mcp_config_path() if config is None else config
    if resolved is None:
        raise ValueError(
            "Set KNOLO_MCP_CONFIG to an absolute knolo-mcp.json path."
        )
    return McpToolset(connection_params=connection_params(resolved))


def build_agent(config: Path | None = None) -> LlmAgent:
    return LlmAgent(
        model="gemini-2.5-flash",
        name="knolo_reader",
        description=(
            "Searches a pinned Knolo Knowledge Image and reports receipt ids."
        ),
        instruction=(
            "Answer from knolo_search only. Include each receipt id in the "
            "reply. A receipt means the image pin and policy check ran. It "
            "does not mean a claim is proven. Do not invent passages."
        ),
        tools=[knolo_toolset(config)],
    )


_config = mcp_config_path()
root_agent = build_agent(_config) if _config is not None else None
