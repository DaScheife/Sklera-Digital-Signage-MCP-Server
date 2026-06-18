import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatToolError, successText } from "../services/client.js";
import { ClientRegistry } from "../services/registry.js";
import { instanceField } from "./shared.js";

/**
 * Provisioning API tools — READ-ONLY.
 *
 * Base path: {baseUrl}/data/api/provisioning, auth header `apiToken`, same
 * per-instance baseUrl/token as the Data API. Only GET endpoints are bound
 * here. There are deliberately NO tools for the mutating provisioning
 * endpoints (createAccount, edit, setExpired, changeScreenCount,
 * deleteAccount). The SkleraClient additionally refuses any POST/PUT/DELETE
 * against a provisioning path, so the connector is technically incapable of
 * altering accounts or channels.
 */
export function registerProvisioningTools(server: McpServer, registry: ClientRegistry): void {
  server.registerTool(
    "sklera_provisioning_list",
    {
      title: "Provisioning: List Accounts (read-only)",
      description: `Lists provisioning accounts (channels + users) via
GET /provisioning/list. Read-only.

Optional filters narrow the result: username, userId, email, licenseType,
channelName. Each returned account includes its channelId. Depending on the
token's reseller scope, accounts of other resellers may appear.

Multi-instance: set "instance" to a configured Sklera domain; omit for default.`,
      inputSchema: {
        ...instanceField,
        username: z.string().optional().describe("Optional filter: username"),
        userId: z.string().optional().describe("Optional filter: user id"),
        email: z.string().optional().describe("Optional filter: email"),
        licenseType: z.string().optional().describe("Optional filter: license type"),
        channelName: z.string().optional().describe("Optional filter: channel name"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ instance, ...filters }) => {
      try {
        const client = registry.resolve(instance);
        // Only defined filters are forwarded as query params.
        const params: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(filters)) {
          if (value !== undefined) params[key] = value;
        }
        const data = await client.get("/provisioning/list", params);
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_provisioning_get",
    {
      title: "Provisioning: Get Account (read-only)",
      description: `Returns one provisioning account via
GET /provisioning/get/{channelId}. Read-only.

Multi-instance: set "instance" to a configured Sklera domain; omit for default.`,
      inputSchema: {
        ...instanceField,
        channelId: z.string().min(1).describe("Channel id of the account to fetch"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ instance, channelId }) => {
      try {
        const client = registry.resolve(instance);
        const data = await client.get(`/provisioning/get/${encodeURIComponent(channelId)}`);
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );
}
