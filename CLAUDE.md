# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build   # TypeScript → dist/ (required before npm start)
npm start       # Run compiled server (node dist/index.js)
npm run dev     # Run in dev mode without compiling (ts-node src/index.ts)
```

There are no test or lint scripts configured.

## Architecture

This is an MCP (Model Context Protocol) server that bridges LLM clients (Claude Desktop, etc.) to the Sklera Digital Signage API. The server exposes ~50 tools covering screens, playlists, content library, reporting, rooms, and more.

### Transport modes

Controlled by the `TRANSPORT` env var (default: `stdio`):

- **stdio** — for local Claude Desktop connections; credentials come from env vars
- **http** — for remote/multi-user deployments; credentials are resolved per request

### Request flow

```
Transport (stdio / HTTP POST /mcp)
  → buildServer(registry)           # creates a fresh McpServer with all tools
  → tool handler (Zod validation)
  → SkleraClient method
  → Sklera REST API
```

In HTTP mode, `buildServer` is called **per request** — each request gets its own isolated `McpServer` + `SkleraClient`. In stdio mode it's called once at startup.

### Key files

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point; `runStdio()` / `runHTTP()`; `buildServer()` wires all tools |
| `src/services/client.ts` | `SkleraClient` — axios wrapper around two API bases; `formatToolError()` / `successText()` helpers used by every tool |
| `src/services/registry.ts` | `ClientRegistry` — holds one `SkleraClient` per named Sklera domain; `loadRegistryFromEnv()` / `loadRegistryFromHeaders()` |
| `src/services/oauth.ts` | `SkleraOAuthProvider` — OAuth 2.1 server; enabled when `PUBLIC_URL` is set |
| `src/tools/` | Tool registration grouped by domain (see below) |

### Two API bases inside SkleraClient

`SkleraClient` maintains two separate axios instances:

- **`http`** → `{baseUrl}/data/api` — main API; token passed as `apiToken` header
- **`roomHttp`** → `{baseUrl}/channelApi/roomManager` — Roommanager API; token passed as `apiToken` **query parameter**; bodies are either JSON or `application/x-www-form-urlencoded`

### Tool files

| File | Registers |
|------|-----------|
| `src/tools/screens.ts` | `registerChannelTools`, `registerScreenTools` |
| `src/tools/playlists.ts` | `registerPlaylistTools`, `registerNodeTools` |
| `src/tools/content.ts` | `registerItemTools`, `registerPlayoutTools`, `registerMessageTools`, `registerCustomValueTools` |
| `src/tools/reporting.ts` | `registerReportingTools` |
| `src/tools/users.ts` | `registerUserTools` |
| `src/tools/rooms.ts` | `registerRoomManagerTools` |

Most tools take `client: SkleraClient` directly. `registerUserTools` and `registerRoomManagerTools` receive the `ClientRegistry` because they support an optional `instance` parameter for multi-domain deployments.

### Credential resolution (HTTP mode, in order)

1. OAuth bearer token (only when `PUBLIC_URL` is set and GUI connector is used)
2. `x-sklera-instances` header (JSON, multi-domain)
3. `x-sklera-token` + optional `x-sklera-url` header (single domain)
4. Env var fallback (`SKLERA_API_TOKEN` / `SKLERA_INSTANCES`) if present

### Environment variables

| Variable | Description |
|----------|-------------|
| `TRANSPORT` | `stdio` (default) or `http` |
| `SKLERA_API_TOKEN` | Required for stdio / optional env fallback in HTTP |
| `SKLERA_BASE_URL` | Default: `https://my.sklera.tv` |
| `SKLERA_INSTANCES` | JSON for multi-domain: `{"default":"x","instances":{"x":{"baseUrl":"...","apiToken":"..."}}}` |
| `PUBLIC_URL` | Enables OAuth 2.1; must be a public HTTPS origin |
| `OAUTH_STORE_FILE` | Path to persist OAuth client registrations and tokens |
| `PORT` | HTTP mode port (default: 3000) |
| `HOST` | HTTP bind address (default: `0.0.0.0`) |

### Error handling pattern

`wrapError()` in `SkleraClient` treats responses with `success: true` / `"true"` / `true` as successful even on non-2xx status codes (Sklera API quirk). Tool handlers call `successText(data)` for success or `formatToolError(err)` for errors, both returning `string` content for the MCP response.
