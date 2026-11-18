"""One Microsoft Agent Framework agent that searches a pinned Knolo image.

The host owns the model. Importing this module does not call one and does not
start the server. Agent Framework 1.26.0 names the agent class ``Agent``.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from agent_framework import Agent, MCPStdioTool

PUBLISHED_PACKAGE = "@knolo/mcp@0.2.4"


def mcp_config_path() -> Path | None:
    raw = os.environ.get("KNOLO_MCP_CONFIG", "").strip()
    if not raw:
        return None
    path = Path(raw)
    if not path.is_absolute():
        raise ValueError("KNOLO_MCP_CONFIG must be an absolute path.")
    return path


def server_command() -> tuple[str, list[str]]:
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
    return command, args


def knolo_tool(config: Path | None = None) -> MCPStdioTool:
    resolved = mcp_config_path() if config is None else config
    if resolved is None:
        raise ValueError(
            "Set KNOLO_MCP_CONFIG to an absolute knolo-mcp.json path."
        )
    command, args = server_command()
    return MCPStdioTool(
        name="knolo",
        command=command,
        args=[*args, "--config", str(resolved)],
        description=(
            "Searches a pinned Knolo Knowledge Image. A receipt checks "
            "integrity. It does not mean a claim is proven."
        ),
        load_prompts=False,
    )


def build_agent(client: object, tool: MCPStdioTool) -> Agent:
    return Agent(
        client=client,
        name="knolo_reader",
        description=(
            "Searches a pinned Knolo Knowledge Image and reports receipt ids."
        ),
        instructions=(
            "Answer from knolo_search only. Include each receipt id and "
            "object id in the reply. A receipt means the image pin and "
            "policy check ran. It does not mean a claim is proven. Do not "
            "invent passages."
        ),
        tools=tool,
    )
