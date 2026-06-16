import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import express from "express";
import {
  loadRegistryFromEnv,
  loadRegistryFromHeaders,
  buildRegistryFromInstances,
  ClientRegistry,
} from "./services/registry.js";
import { SkleraOAuthProvider } from "./services/oauth.js";
import type { OAuthInstanceMap } from "./services/oauth.js";
import { registerChannelTools, registerScreenTools } from "./tools/screens.js";
import { registerPlaylistTools, registerNodeTools } from "./tools/playlists.js";
import { registerItemTools, registerPlayoutTools, registerMessageTools, registerCustomValueTools } from "./tools/content.js";
import { registerReportingTools } from "./tools/reporting.js";
import { registerUserTools } from "./tools/users.js";
import { registerRoomManagerTools } from "./tools/rooms.js";

const SERVER_VERSION = "0.7.0";

/**
 * Builds a fully configured McpServer for the given registry.
 *
 * stdio mode: called once at startup with the env-based registry.
 * HTTP mode:  called per request with a registry derived from the
 *             OAuth access token, the request headers, or the env fallback.
 */
function buildServer(registry: ClientRegistry): McpServer {
  const server = new McpServer({
    name: "sklera-mcp-server",
    version: SERVER_VERSION,
  });

  // Every tool receives the full registry and resolves its target instance from
  // the optional `instance` parameter, falling back to the default instance.
  registerChannelTools(server, registry);
  registerScreenTools(server, registry);
  registerPlaylistTools(server, registry);
  registerNodeTools(server, registry);
  registerItemTools(server, registry);
  registerPlayoutTools(server, registry);
  registerMessageTools(server, registry);
  registerCustomValueTools(server, registry);
  registerReportingTools(server, registry);
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

async function handleMcpRequest(req: express.Request, res: express.Response, registry: ClientRegistry): Promise<void> {
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
}

async function runHTTP(): Promise<void> {
  // Optional env fallback: allows single-tenant remote deployments where
  // credentials live on the server. Absence is fine in multi-user mode,
  // where every request must carry its own credentials.
  let envRegistry: ClientRegistry | null = null;
  try {
    envRegistry = loadRegistryFromEnv();
    process.stderr.write("HTTP mode: env credentials present (single-tenant fallback active)\n");
  } catch {
    process.stderr.write("HTTP mode: no env credentials; per-request auth required\n");
  }

  // OAuth is enabled when PUBLIC_URL is set. PUBLIC_URL must be the externally
  // reachable https origin of this server (e.g. https://mcp.example.net), since
  // it becomes the OAuth issuer and the advertised resource identifier. This is
  // what makes the server addable through Claude's GUI custom-connector flow.
  const publicUrlRaw = process.env.PUBLIC_URL?.trim();
  const oauthEnabled = Boolean(publicUrlRaw);

  const app = express();

  let oauthProvider: SkleraOAuthProvider | null = null;
  let resourceMetadataUrl: string | undefined;

  if (oauthEnabled) {
    const issuerUrl = new URL(publicUrlRaw as string);
    const resourceServerUrl = new URL("/mcp", issuerUrl);
    resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceServerUrl);

    oauthProvider = new SkleraOAuthProvider({
      storeFile: process.env.OAUTH_STORE_FILE,
    });

    // The login form posts URL-encoded data; parse it only for that route.
    app.post(
      oauthProvider.getLoginPath(),
      express.urlencoded({ extended: false }),
      async (req, res) => {
        const body = req.body as Record<string, string>;
        const result = await (oauthProvider as SkleraOAuthProvider).issueAuthorizationCode({
          clientId: body.client_id ?? "",
          redirectUri: body.redirect_uri ?? "",
          codeChallenge: body.code_challenge ?? "",
          state: body.state ?? "",
          scope: body.scope ?? "",
          resource: body.resource ?? "",
          skleraToken: body.sklera_token ?? "",
          baseUrl: body.base_url ?? "",
          instancesJson: body.instances_json ?? "",
        });
        if ("error" in result) {
          res
            .status(400)
            .set("Content-Type", "text/html; charset=utf-8")
            .send((oauthProvider as SkleraOAuthProvider).renderLoginError(result.error, body));
          return;
        }
        res.redirect(302, result.redirect);
      }
    );

    // Mounts /authorize, /token, /register, /revoke and the well-known
    // metadata documents (RFC 8414 + RFC 9728) at the application root.
    app.use(
      mcpAuthRouter({
        provider: oauthProvider,
        issuerUrl,
        resourceServerUrl,
        scopesSupported: ["sklera"],
        resourceName: "Sklera MCP Server",
      })
    );

    process.stderr.write(`HTTP mode: OAuth enabled, issuer ${issuerUrl.href}\n`);
  } else {
    process.stderr.write("HTTP mode: OAuth disabled (PUBLIC_URL not set); header/env auth only\n");
  }

  // JSON body parsing for the MCP endpoint itself.
  const jsonParser = express.json({ limit: "4mb" });

  // Bearer verification middleware (only constructed in OAuth mode). It sets
  // req.auth on success and answers 401 with a WWW-Authenticate header that
  // points Claude at the protected-resource metadata, triggering the flow.
  const bearerMiddleware = oauthEnabled
    ? requireBearerAuth({
        verifier: oauthProvider as SkleraOAuthProvider,
        resourceMetadataUrl,
      })
    : null;

  app.post("/mcp", jsonParser, async (req, res, next) => {
    const hasBearer = (req.headers.authorization ?? "").toLowerCase().startsWith("bearer ");

    // Path 1: OAuth bearer token (GUI custom connector).
    if (oauthEnabled && hasBearer && bearerMiddleware) {
      bearerMiddleware(req, res, (err?: unknown) => {
        if (err) {
          next(err);
          return;
        }
        const extra = req.auth?.extra as
          | { instances?: OAuthInstanceMap; skleraToken?: string; baseUrl?: string }
          | undefined;

        // Preferred path: the token carries a full instance map (multi-instance
        // OAuth). Legacy tokens carry only skleraToken/baseUrl and are treated
        // as a single instance named "default".
        let registry: ClientRegistry;
        try {
          if (extra?.instances && Object.keys(extra.instances.instances ?? {}).length > 0) {
            registry = buildRegistryFromInstances(extra.instances, "OAuth token instances");
          } else if (extra?.skleraToken) {
            registry = new ClientRegistry(
              { default: { baseUrl: extra.baseUrl ?? "https://my.sklera.tv", apiToken: extra.skleraToken } },
              "default"
            );
          } else {
            res.status(401).json({
              jsonrpc: "2.0",
              error: { code: -32001, message: "Token carries no Sklera credentials" },
              id: null,
            });
            return;
          }
        } catch (buildErr) {
          res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: buildErr instanceof Error ? buildErr.message : String(buildErr) },
            id: null,
          });
          return;
        }
        void handleMcpRequest(req, res, registry).catch(next);
      });
      return;
    }

    // Path 2: per-request credential headers (config-file connector) or env.
    let registry: ClientRegistry | null;
    try {
      registry = loadRegistryFromHeaders(req.headers);
    } catch (err) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
        id: null,
      });
      return;
    }
    if (!registry) registry = envRegistry;

    if (!registry) {
      // In OAuth mode, advertise the metadata so the GUI starts the flow.
      if (oauthEnabled && resourceMetadataUrl) {
        res.set(
          "WWW-Authenticate",
          `Bearer resource_metadata="${resourceMetadataUrl}"`
        );
      }
      res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: oauthEnabled
            ? "Unauthorized: authorize via OAuth or provide X-Sklera-Token / X-Sklera-Instances header"
            : "Unauthorized: provide X-Sklera-Token (+ optional X-Sklera-Url) or X-Sklera-Instances header",
        },
        id: null,
      });
      return;
    }

    await handleMcpRequest(req, res, registry);
  });

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      server: "sklera-mcp-server",
      version: SERVER_VERSION,
      oauth: oauthEnabled,
    });
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
