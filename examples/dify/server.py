"""Stdio MCP server settings for the Dify example.

The host owns the model. Importing this module does not connect and does
not call a model. Dify's built-in client accepts an http or https URL, so
this module does not open a port.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

PUBLISHED_PACKAGE = "@knolo/mcp@0.2.0"
PUBLISHED_COMMAND = "npx"
PUBLISHED_ARGS = ["-y", PUBLISHED_PACKAGE]
PLACEHOLDER_CONFIG = "/absolute/knolo-mcp.json"
SERVER_NAME = "knolo"


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


def published_mcp_config() -> dict:
    return {
        "mcpServers": {
            SERVER_NAME: {
                "command": PUBLISHED_COMMAND,
                "args": [*PUBLISHED_ARGS, "--config", PLACEHOLDER_CONFIG],
            }
        }
    }
