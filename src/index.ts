import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import {
  loadRegistryFromEnv,
  loadRegistryFromHeaders,
  ClientRegistry,
} from "./services/registry.js";
import { registerChannelTools, registerScreenTools } from "./tools/screens.js";
import { registerPlaylistTools, registerNodeTools } from "./tools/playlists.js";
import { registerItemTools, registerPlayoutTools, registerMessageTools, registerCustomValueTools } from "./tools/content.js";
import { registerReportingTools } from "./tools/reporting.js";
import { registerUserTools } from "./tools/users.js";
import { registerRoomManagerTools } from "./tools/rooms.js";

const SERVER_VERSION = "0.3.0";

/**
 * Builds a fully configured McpServer for the given registry.
 *
 * stdio mode: called once at startup with the env-based registry.
 * HTTP mode:  called per request with a registry derived from the
 *             request headers (or the env fallback).
 */
function buildServer(registry: ClientRegistry): McpServer {
  const server = new McpServer({
    name: "sklera-mcp-server",
    version: SERVER_VERSION,
  });

  const client = registry.default();

  registerChannelTools(server, client);
  registerScreenTools(server, client);
  registerPlaylistTools(server, client);
  registerNodeTools(server, client);
  registerItemTools(server, client);
  registerPlayoutTools(server, client);
  registerMessageTools(server, client);
  registerCustomValueTools(server, client);
  registerReportingTools(server, client);
  registerUserTools(server, registry);
  registerRoomManagerTools(server, registry);

  return server;
}

// ---------------------------------------------------------------------------
// stdio transport (local mode, Claude Desktop)
// ---------------------------------------------------------------------------

async function runStdio(): Promise<void> {
  let registry: ClientRegistry;
  try {
    registry = loadRegistryFromEnv();
  } catch (err) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  const server = buildServer(registry);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`Sklera MCP server v${SERVER_VERSION} running on stdio\n`);
}

// ---------------------------------------------------------------------------
// Streamable HTTP transport (remote mode, multi-user)
// ---------------------------------------------------------------------------

async function runHTTP(): Promise<void> {
  // Optional env fallback: allows single-tenant remote deployments where
  // credentials live on the server. Absence is fine in multi-user mode,
  // where every request must carry its own credentials via headers.
  let envRegistry: ClientRegistry | null = null;
  try {
    envRegistry = loadRegistryFromEnv();
    process.stderr.write("HTTP mode: env credentials present (single-tenant fallback active)\n");
  } catch {
    process.stderr.write("HTTP mode: no env credentials; per-request headers required\n");
  }

  const app = express();
  app.use(express.json({ limit: "4mb" }));

  app.post("/mcp", async (req, res) => {
    let registry: ClientRegistry | null;
    try {
      registry = loadRegistryFromHeaders(req.headers);
    } catch (err) {
      // Malformed credential headers (e.g. invalid x-sklera-instances JSON).
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
        id: null,
      });
      return;
    }

    if (!registry) registry = envRegistry;

    if (!registry) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message:
            "Unauthorized: provide X-Sklera-Token (+ optional X-Sklera-Url) or X-Sklera-Instances header",
        },
        id: null,
      });
      return;
    }

    const server = buildServer(registry);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: "sklera-mcp-server", version: SERVER_VERSION });
  });

  const port = parseInt(process.env.PORT ?? "3000");
  const host = process.env.HOST ?? "0.0.0.0";
  app.listen(port, host, () => {
    process.stderr.write(
      `Sklera MCP server v${SERVER_VERSION} running on http://${host}:${port}/mcp\n`
    );
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const transport = process.env.TRANSPORT ?? "stdio";
if (transport === "http") {
  runHTTP().catch((err: unknown) => {
    process.stderr.write(`Server error: ${String(err)}\n`);
    process.exit(1);
  });
} else {
  runStdio().catch((err: unknown) => {
    process.stderr.write(`Server error: ${String(err)}\n`);
    process.exit(1);
  });
}
