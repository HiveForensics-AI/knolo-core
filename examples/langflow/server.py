"""Stdio MCP server settings for the Langflow example.

The host owns the model. Importing this module does not connect and does
not call a model.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

os.environ.setdefault("LANGFLOW_DO_NOT_TRACK", "true")
os.environ.setdefault("DO_NOT_TRACK", "true")

PUBLISHED_PACKAGE = "@knolo/mcp@0.2.3"
PUBLISHED_COMMAND = "npx"
PUBLISHED_ARGS = ["-y", PUBLISHED_PACKAGE]
PLACEHOLDER_CONFIG = "/absolute/knolo-mcp.json"
SERVER_NAME = "knolo"
AGENT_INSTRUCTIONS = (
    "Answer from knolo_search results. Include the receipt id. "
    "A receipt checks integrity and does not mean a claim is proven."
)


def mcp_config_path() -> Path | None:
    raw = os.environ.get("KNOLO_MCP_CONFIG", "").strip()
    if not raw:
        return None
    path = Path(raw)
    if not path.is_absolute():
        raise ValueError("KNOLO_MCP_CONFIG must be an absolute path.")
    return path


def server_args() -> list[str]:
    raw = os.environ.get("KNOLO_MCP_ARGS")
    if raw is None:
        return list(PUBLISHED_ARGS)
    parsed = json.loads(raw)
    if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
        raise ValueError("KNOLO_MCP_ARGS must be a JSON array of strings.")
    return list(parsed)


def command_args(config: Path) -> tuple[str, list[str]]:
    command = os.environ.get("KNOLO_MCP_COMMAND", PUBLISHED_COMMAND)
    args = server_args()
    config_text = str(config)
    if "--config" in args:
        index = args.index("--config")
        if index + 1 >= len(args):
            raise ValueError("KNOLO_MCP_ARGS --config is missing a path.")
        updated = list(args)
        updated[index + 1] = config_text
        return command, updated
    return command, [*args, "--config", config_text]


def stdio_server_value(config: Path) -> dict:
    command, args = command_args(config)
    return {
        "name": SERVER_NAME,
        "config": {
            "mode": "Stdio",
            "command": command,
            "args": args,
        },
    }


def published_stdio_value() -> dict:
    return {
        "name": SERVER_NAME,
        "config": {
            "mode": "Stdio",
            "command": PUBLISHED_COMMAND,
            "args": [*PUBLISHED_ARGS, "--config", PLACEHOLDER_CONFIG],
        },
    }
