# Smithery, Glama, PulseMCP, and mcp.so

Draft listings for issue #209. Each submission is a separate account step.
A maintainer signs in to each directory and completes its review. When a
listing is live, record its URL in the table at the end of this file and
update the line in `packages/mcp/README.md`.

Use the name `Knolo` and the package `@knolo/mcp` in every listing. A search
for "knolo" on these directories can return unrelated names, so the listing
name and the first words of the description both say Knolo.

## Shared listing copy

| Field | Value |
| --- | --- |
| Name | Knolo |
| Package | `@knolo/mcp@0.2.4` |
| Registry name | `io.github.HiveForensics-AI/knolo` |
| Description | Knolo: pinned Knowledge Images with read-only search, KAR evaluation, and Cortex checks. |
| Transport | stdio. The server does not listen on a port and has no remote URL. |
| Required config | `KNOLO_MCP_CONFIG`, the absolute path to the knolo-mcp config JSON. It is not a secret. |
| API key | None |
| License | Apache-2.0 |
| Repository | https://github.com/HiveForensics-AI/knolo-core/tree/main/packages/mcp |
| Logo (400×400) | https://raw.githubusercontent.com/HiveForensics-AI/knolo-core/main/packages/mcp/listings/cline/logo.png |
| Node | 20 or newer |

Install command for listings that show one:

```sh
npx -y @knolo/mcp@0.2.4 --config /absolute/knolo-mcp.json
```

Client block for listings that show one:

```json
{
  "mcpServers": {
    "knolo": {
      "command": "npx",
      "args": ["-y", "@knolo/mcp@0.2.4", "--config", "/absolute/knolo-mcp.json"]
    }
  }
}
```

## Smithery

Smithery lists a local stdio server as an MCPB bundle. Clients download the
bundle and run it on their own machine. The URL publish path is for servers
that expose Streamable HTTP. Knolo does not, so that path does not apply.

This repository does not build an `.mcpb` bundle yet. Building one is a
separate change. With a bundle, a Smithery publisher runs:

```sh
npx smithery mcp publish ./knolo-mcp.mcpb -n <smithery-namespace>/knolo
```

## Glama

Glama lets a maintainer claim a listing from a `glama.json` file at the root
of the repository. This repository belongs to an organization, so the file
must exist before the claim. `maintainers` holds GitHub usernames. A
maintainer fills in the names. The draft is:

```json
{
  "$schema": "https://glama.ai/mcp/schemas/server.json",
  "maintainers": ["<github-username>"]
}
```

The repository root already has an Apache-2.0 `LICENSE`. The server lives in
`packages/mcp`, not at the root. After the claim, set the Docker build in the
Glama admin page to [`packages/mcp/Dockerfile`](../Dockerfile).

## PulseMCP

PulseMCP reads the official MCP Registry. This server is in that registry as
`io.github.HiveForensics-AI/knolo`. Check the PulseMCP search for "knolo"
before submitting. When this was drafted, the PulseMCP submit page said
submissions were paused. If no listing appears, use the submit page when it
reopens with the shared copy above.

## mcp.so

Submit from the Submit button on mcp.so. The form takes the server URL and
an optional avatar URL:

- URL: https://github.com/HiveForensics-AI/knolo-core/tree/main/packages/mcp
- Avatar: the logo URL in the shared copy

## Live listings

| Directory | Listing URL | Version |
| --- | --- | --- |
| Smithery | Not listed | |
| Glama | Not listed | |
| PulseMCP | Not listed | |
| mcp.so | Not listed | |
