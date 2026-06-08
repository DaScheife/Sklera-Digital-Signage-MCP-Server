import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SkleraClient, formatToolError, successText } from "../services/client.js";

export function registerChannelTools(server: McpServer, client: SkleraClient): void {
  server.registerTool(
    "sklera_list_channels",
    {
      title: "List Channels",
      description: `Lists all Sklera channels accessible with the current API token.

Returns channel IDs, names, types, storage quotas and language settings.
Use the returned _id as channelId in other tools (items, playlists, screens, etc.).`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const data = await client.get("/channels/list");
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );
}

export function registerScreenTools(server: McpServer, client: SkleraClient): void {
  server.registerTool(
    "sklera_list_screens",
    {
      title: "List Screens",
      description: `Returns all screens (players) across all accessible channels.

Each screen includes: _id, name, channelId, channelName, deviceType, resolution,
buildVersion, screenGroupId, customId, address, operatingTimes, registered, updatedAt.
Use _id as screenId in other screen tools.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const data = await client.get("/screens/list");
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_screen_stats",
    {
      title: "Screen Statistics",
      description: `Returns online/offline statistics for all screens, grouped by channel.

Includes totalStats (screenCount, screenOnlineStats for current/lastDay/last7Days/last30Days)
and per-channel breakdown. Useful for fleet health monitoring.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const data = await client.get("/screens/stats");
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_screen_connection_status",
    {
      title: "Screen Connection Status",
      description: `Returns real-time connection state for all screens.

Each entry contains: screenName, screenState, connected (boolean), isStandby, lastUpdated, warning.
Optionally filter by channelId. Leave channelId empty to get status for all accessible channels.`,
      inputSchema: {
        channelId: z.string().optional().describe("Optional: filter by channel ID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ channelId }) => {
      try {
        const body = channelId ? { channelId } : {};
        const data = await client.get("/screens/getConnectionStatus", body as Record<string, unknown>);
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_send_screen_command",
    {
      title: "Send Screen Command",
      description: `Sends a remote command to a specific screen/player.

Available commands:
- viewer_previous / viewer_next: Navigate playlist spots
- viewer_pause: Pause playback
- device_restart: Restart the player application
- device_reload: Reload content
- device_redownload: Force full content re-download
- device_clear_download: Clear local download cache
- app_hide / app_show: Hide or show the player overlay
- trigger_touch_action / trigger_app_event: Trigger interactive events

Identify the screen either by id (screenId) or by name+channelId combination.`,
      inputSchema: {
        screenId: z.string().optional().describe("Screen ID (preferred)"),
        screenName: z.string().optional().describe("Screen name (requires channelId)"),
        channelId: z.string().optional().describe("Required when using screenName"),
        cmd: z.enum([
          "viewer_previous", "viewer_next", "viewer_pause",
          "device_restart", "device_reload", "device_redownload", "device_clear_download",
          "trigger_touch_action", "trigger_app_event",
          "app_hide", "app_show",
        ]).describe("Command to send"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ screenId, screenName, channelId, cmd }) => {
      try {
        if (!screenId && !screenName) {
          return { content: [{ type: "text", text: "Error: either screenId or screenName must be provided" }], isError: true };
        }
        const body: Record<string, unknown> = { cmd };
        if (screenId) body.id = screenId;
        if (screenName) body.name = screenName;
        if (channelId) body.channelId = channelId;
        const data = await client.post("/screens/sendCmd", body);
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_edit_screen",
    {
      title: "Edit Screen",
      description: `Updates properties of an existing screen.

Editable fields: name, customId, description, screenGroupId, address, categoryFilter.
Only supply fields you want to change; omitted fields remain unchanged.`,
      inputSchema: {
        screenId: z.string().describe("ID of the screen to edit"),
        name: z.string().optional(),
        customId: z.string().optional(),
        description: z.string().optional(),
        screenGroupId: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ screenId, ...fields }) => {
      try {
        const body = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
        const data = await client.put(`/screens/edit/${screenId}`, body);
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_list_screengroups",
    {
      title: "List Screen Groups",
      description: `Returns all screen groups for a given channel.

Each group includes: _id, name, channelId, isDefault, and the assigned playlists list.
Screen groups are used in Playouts to target sets of screens.`,
      inputSchema: {
        channelId: z.string().describe("Channel ID to retrieve screen groups from"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ channelId }) => {
      try {
        const data = await client.get("/screengroups/list", { channelId });
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );
}
