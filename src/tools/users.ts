import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatToolError, successText } from "../services/client.js";
import { ClientRegistry } from "../services/registry.js";
import { instanceField } from "./shared.js";

export function registerUserTools(server: McpServer, registry: ClientRegistry): void {
  server.registerTool(
    "sklera_list_users",
    {
      title: "List Users",
      description: `Returns all user accounts visible to the current API token.

Each user includes: _id, username, firstname, lastname, company, language,
channels (array of channel IDs the user can access), channelId (primary channel),
address (street, housenumber, doornumber, zipcode, city, country),
phone.mobile, and lastLogin (ISO 8601 UTC).

Use this to audit which users have access to which channels.

Multi-instance: set "instance" to the name of a configured Sklera domain to
query that instance; omit it to use the default instance.`,
      inputSchema: { ...instanceField },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ instance }) => {
      try {
        const client = registry.resolve(instance);
        const data = await client.get("/users/list");
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );
}
