import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { loadRegistryFromEnv, ClientRegistry } from "./services/registry.js";
import { registerChannelTools, registerScreenTools } from "./tools/screens.js";
import { registerPlaylistTools, registerNodeTools } from "./tools/playlists.js";
import { registerItemTools, registerPlayoutTools, registerMessageTools, registerCustomValueTools } from "./tools/content.js";
import { registerReportingTools } from "./tools/reporting.js";
import { registerUserTools } from "./tools/users.js";
import { registerRoomManagerTools } from "./tools/rooms.js";

const SERVER_VERSION = "0.2.1";

function initRegistry(): ClientRegistry {
  try {
    return loadRegistryFromEnv();
  } catch (err) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

const registry = initRegistry();

function buildServer(): McpServer {
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

async function runStdio(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`Sklera MCP server v${SERVER_VERSION} running on stdio\n`);
}

async function runHTTP(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: "sklera-mcp-server", version: SERVER_VERSION });
  });

  const port = parseInt(process.env.PORT ?? "3000");
  app.listen(port, () => {
    process.stderr.write(`Sklera MCP server v${SERVER_VERSION} running on http://localhost:${port}/mcp\n`);
  });
}

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
