# Haystack catalog draft

This file is a draft of a haystack-integrations page. It is not submitted. The page links only to packages that are already published. `@knolo/mcp` is on npm. It is not a PyPI package. The Haystack client is published `mcp-haystack`. The catalog template labels pages `Haystack 2.0`. The example in this repository installs `mcp-haystack==2.1.1`.

`logo` is empty. This draft does not add a logo file.

```yaml
---
layout: integration
name: Knolo
description: Read a pinned Knolo Knowledge Image from Haystack over MCP stdio.
authors:
  - name: Hive Forensics
    socials:
      github: HiveForensics-AI
pypi: https://www.npmjs.com/package/@knolo/mcp
repo: https://github.com/HiveForensics-AI/knolo-core
type: Tool Integration
report_issue: https://github.com/HiveForensics-AI/knolo-core/issues
logo:
version: Haystack 2.0
toc: true
---
```

### **Table of Contents**

- [Overview](#overview)
- [Installation](#installation)
- [Usage](#usage)
- [Examples](#examples)
- [License](#license)

## Overview

Knolo exposes a pinned V5 Knowledge Image through the published MCP server `@knolo/mcp`. Haystack reaches that server with `mcp-haystack` and `StdioServerInfo`. The server is stdio only. Knolo does not call a model.

A mount without a `kar` block exposes `knolo_search`, `knolo_get`, `knolo_verify`, and `knolo_status`. A search writes an `openclaw-knolo-query-v1` receipt. A receipt is an integrity check. `SATISFIED`, when a mount includes the KAR tools, means the evidence requirements in the plan were met.

The server package is [https://www.npmjs.com/package/@knolo/mcp](https://www.npmjs.com/package/@knolo/mcp). The Haystack client is [https://pypi.org/project/mcp-haystack/](https://pypi.org/project/mcp-haystack/).

## Installation

```bash
pip install mcp-haystack==2.1.1
```

Node.js is required because the published server command is:

```bash
npx -y @knolo/mcp@0.2.1 --config /absolute/knolo-mcp.json
```

## Usage

```python
from haystack_integrations.tools.mcp import MCPToolset, StdioServerInfo

toolset = MCPToolset(
    server_info=StdioServerInfo(
        command="npx",
        args=["-y", "@knolo/mcp@0.2.1", "--config", "/absolute/knolo-mcp.json"],
    ),
    connection_timeout=60,
    invocation_timeout=60,
    eager_connect=True,
)
search = next(tool for tool in toolset.tools if tool.name == "knolo_search")
result = search.invoke(query="enterprise refunds", limit=4)
```

`eager_connect` must be true. A false value leaves a placeholder tool. The command and the argument list are separate, so a config path that contains spaces stays one argument. Pins, policy, and the audit directory stay in the config file. Tool arguments cannot set the caller.

## Examples

The published server and the config contract are documented in the repository at [https://github.com/HiveForensics-AI/knolo-core](https://github.com/HiveForensics-AI/knolo-core). Pass an absolute path to a `knolo-mcp.json` that pins an image you already built. The host owns any model call.

## License

`@knolo/mcp` and this repository are distributed under the terms of the [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) license.
