"""Stdio MCP server settings for Agno.

The host owns the model. Importing this module does not connect and does
not call a model.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from mcp import StdioServerParameters

os.environ.setdefault("AGNO_TELEMETRY", "false")

PUBLISHED_PACKAGE = "@knolo/mcp@0.2.1"


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
        return ["-y", PUBLISHED_PACKAGE]
    parsed = json.loads(raw)
    if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
        raise ValueError("KNOLO_MCP_ARGS must be a JSON array of strings.")
    return list(parsed)


def server_parameters(config: Path) -> StdioServerParameters:
    command = os.environ.get("KNOLO_MCP_COMMAND", "npx")
    return StdioServerParameters(
        command=command,
        args=[*server_args(), "--config", str(config)],
    )
