import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatToolError, successText } from "../services/client.js";
import { ClientRegistry } from "../services/registry.js";
import { instanceField } from "./shared.js";

/** Network block as returned per screen; shape varies by deviceType (LG vs. cordova). */
interface NetworkInfo {
  wifi?: { ipAddress?: string } | null;
  wired?: { ipAddress?: string } | null;
  interfaces?: Array<{ address?: string } | null> | null;
  [key: string]: unknown;
}

/** Raw screen as returned by /screens/list. Only the fields we read are typed; the rest is preserved. */
interface RawScreen {
  channelId?: string;
  platformInfo?: { modelName?: unknown } | null;
  networkInfo?: NetworkInfo | null;
  [key: string]: unknown;
}

/**
 * Best-effort extraction of a screen's primary IPv4 address from its networkInfo.
 * Handles the LG shape (`wifi`/`wired.ipAddress`) and the cordova shape
 * (`interfaces[].address`). Returns undefined when no address is present.
 */
function extractIp(networkInfo: NetworkInfo | null | undefined): string | undefined {
  if (!networkInfo || typeof networkInfo !== "object") return undefined;
  if (networkInfo.wifi?.ipAddress) return networkInfo.wifi.ipAddress;
  if (networkInfo.wired?.ipAddress) return networkInfo.wired.ipAddress;
  if (Array.isArray(networkInfo.interfaces)) {
    const iface = networkInfo.interfaces.find((i) => i && typeof i.address === "string");
    if (iface?.address) return iface.address;
  }
  return undefined;
}

/**
 * Projects a raw screen down to a slim set of core fields, deriving `model`
 * from platformInfo and `ip` from networkInfo. Large nested objects
 * (platformInfo, networkInfo, operatingTimes, holidays) are dropped. Fields
 * that are absent stay undefined and are omitted by JSON serialization.
 */
function projectScreenCore(screen: RawScreen): Record<string, unknown> {
  return {
    _id: screen._id,
    name: screen.name,
    channelId: screen.channelId,
    channelName: screen.channelName,
    screenGroupId: screen.screenGroupId,
    screenGroupName: screen.screenGroupName,
    deviceType: screen.deviceType,
    model: screen.platformInfo?.modelName,
    resolution: screen.resolution,
    buildVersion: screen.buildVersion,
    ip: extractIp(screen.networkInfo),
    registered: screen.registered,
    updatedAt: screen.updatedAt,
    // Connection-status fields are not part of /screens/list, but are kept here
    // so the projection stays correct if a future response ever includes them.
    connected: screen.connected,
    isStandby: screen.isStandby,
    lastUpdated: screen.lastUpdated,
  };
}

/** Normalizes the /screens/list response (either a bare array or `{ screens: [...] }`) to an array. */
function normalizeScreensList(data: unknown): RawScreen[] {
  if (Array.isArray(data)) return data as RawScreen[];
  const screens = (data as { screens?: unknown } | null)?.screens;
  return Array.isArray(screens) ? (screens as RawScreen[]) : [];
}

export function registerChannelTools(server: McpServer, registry: ClientRegistry): void {
  server.registerTool(
    "sklera_list_channels",
    {
      title: "List Channels",
      description: `Lists all Sklera channels accessible with the current API token.

Returns channel IDs, names, types, storage quotas and language settings.
Use the returned _id as channelId in other tools (items, playlists, screens, etc.).`,
      inputSchema: { ...instanceField },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ instance }) => {
      try {
        const data = await registry.resolve(instance).get("/channels/list");
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );
}

export function registerScreenTools(server: McpServer, registry: ClientRegistry): void {
  server.registerTool(
    "sklera_list_screens",
    {
      title: "List Screens",
      description: `Returns screens (players) across accessible channels.

By default each screen is projected to core fields only (fields="core"):
_id, name, channelId, channelName, screenGroupId, screenGroupName, deviceType,
model, resolution, buildVersion, ip, registered, updatedAt. Pass fields="full"
to get the complete objects including platformInfo, networkInfo, operatingTimes.

Use channelId to restrict to a single channel and limit/offset to page through
large fleets (recommended for instances with thousands of screens to stay within
the response size limit). The response is an envelope:
{ total, offset, limit, returned, screens: [...] }. Use _id as screenId in other
screen tools.`,
      inputSchema: {
        channelId: z.string().optional().describe("Optional: only screens of this channel"),
        limit: z.number().int().positive().optional().describe("Optional: max screens to return (pagination)"),
        offset: z.number().int().nonnegative().optional().describe("Optional: number of screens to skip (pagination)"),
        fields: z
          .enum(["core", "full"])
          .optional()
          .describe('Field projection: "core" (default, slim) or "full" (complete objects)'),
        ...instanceField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ channelId, limit, offset, fields, instance }) => {
      try {
        const data = await registry.resolve(instance).get("/screens/list");
        const all = normalizeScreensList(data);
        // The /screens/list endpoint does not reliably filter server-side, so
        // channelId is applied client-side for predictable results.
        const filtered = channelId ? all.filter((s) => s.channelId === channelId) : all;
        const total = filtered.length;
        const start = offset ?? 0;
        const page = limit !== undefined ? filtered.slice(start, start + limit) : filtered.slice(start);
        const screens = fields === "full" ? page : page.map(projectScreenCore);
        return {
          content: [
            {
              type: "text",
              text: successText({ total, offset: start, limit: limit ?? null, returned: screens.length, screens }),
            },
          ],
        };
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
      inputSchema: { ...instanceField },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ instance }) => {
      try {
        const data = await registry.resolve(instance).get("/screens/stats");
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
      description: `Returns real-time connection state, grouped by channel.

The response is an array of channel groups: { channelId, channelName, screenState: [...] },
where each screenState entry contains: _id, screenName, screenState, connected (boolean),
isStandby, lastUpdated, warning.

Pass channelId to restrict the result to a single channel (recommended for large
instances to stay within the response size limit). Filtering is applied client-side
because the API ignores the channelId query parameter and always returns all channels.
Leave channelId empty to get the status for all accessible channels.`,
      inputSchema: {
        channelId: z.string().optional().describe("Optional: filter by channel ID (single channel)"),
        ...instanceField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ channelId, instance }) => {
      try {
        const data = await registry.resolve(instance).get("/screens/getConnectionStatus");
        // The API returns every channel regardless of any channelId param, so we
        // filter the channel groups client-side when a channelId is requested.
        const result =
          channelId && Array.isArray(data)
            ? (data as Array<{ channelId?: string }>).filter((group) => group.channelId === channelId)
            : data;
        return { content: [{ type: "text", text: successText(result) }] };
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
        ...instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ screenId, screenName, channelId, cmd, instance }) => {
      try {
        if (!screenId && !screenName) {
          return { content: [{ type: "text", text: "Error: either screenId or screenName must be provided" }], isError: true };
        }
        const body: Record<string, unknown> = { cmd };
        if (screenId) body.id = screenId;
        if (screenName) body.name = screenName;
        if (channelId) body.channelId = channelId;
        const data = await registry.resolve(instance).post("/screens/sendCmd", body);
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_lg_upgrade_firmware",
    {
      title: "LG WebOS Firmware Update",
      description: `Triggers a remote firmware update on an LG WebOS screen/player.

Sends the 'device_lg_upgradeFirmware' command with the provided EPK firmware URL
to the specified screen. The player downloads the firmware file independently and
installs it automatically; it will reboot once the installation is complete.

Requirements:
- The API token must belong to a user with the 'Reseller' role.
- The firmware EPK file must be reachable by the player (HTTP preferred; older
  WebOS firmware versions may have problems with LetsEncrypt HTTPS certificates).
- Typical firmware size: ~1.1 GB. There is no remote progress indicator.

Available LG firmware files: https://sklera.tv/firmware/lg

Identify the screen either by screenId or by screenName + channelId.`,
      inputSchema: {
        screenId: z.string().optional().describe("Screen ID (preferred)"),
        screenName: z.string().optional().describe("Screen name (requires channelId)"),
        channelId: z.string().optional().describe("Required when using screenName"),
        firmwareUrl: z.string().url().describe("Full URL to the LG EPK firmware file"),
        ...instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ screenId, screenName, channelId, firmwareUrl, instance }) => {
      try {
        if (!screenId && !screenName) {
          return { content: [{ type: "text", text: "Error: either screenId or screenName must be provided" }], isError: true };
        }
        const body: Record<string, unknown> = {
          cmd: "device_lg_upgradeFirmware",
          firmwareUrl,
        };
        if (screenId) body.id = screenId;
        if (screenName) body.name = screenName;
        if (channelId) body.channelId = channelId;
        const data = await registry.resolve(instance).post("/screens/sendCmd", body);
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
        ...instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ screenId, instance, ...fields }) => {
      try {
        const body = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
        const data = await registry.resolve(instance).put(`/screens/edit/${screenId}`, body);
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
        ...instanceField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ channelId, instance }) => {
      try {
        const data = await registry.resolve(instance).get("/screengroups/list", { channelId });
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );
}
