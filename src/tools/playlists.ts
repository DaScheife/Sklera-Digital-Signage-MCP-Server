import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatToolError, successText } from "../services/client.js";
import { ClientRegistry } from "../services/registry.js";
import { instanceField } from "./shared.js";

export function registerPlaylistTools(server: McpServer, registry: ClientRegistry): void {
  server.registerTool(
    "sklera_list_playlists",
    {
      title: "List Playlists",
      description: `Returns all playlists across all accessible channels.

Each playlist includes: _id, name, channelId, isActive, isScheduled, isRandom,
defaultDuration, defaultTransition, spotsDisabledByDefault.
Use _id as playlistId in node/playout tools.`,
      inputSchema: { ...instanceField },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ instance }) => {
      try {
        const data = await registry.resolve(instance).get("/playlists/list");
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_create_playlist",
    {
      title: "Create Playlist",
      description: `Creates a new playlist in a channel.

Required: name, channelId.
Optional settings: defaultDuration (seconds), defaultTransition (none/fade/fade-out-in/zoom-move/left/right/top/bottom),
isRandom (shuffle), isActive, isScheduled, spotsDisabledByDefault.

Returns the new playlist object including its _id.`,
      inputSchema: {
        name: z.string().describe("Playlist name"),
        channelId: z.string().describe("Target channel ID"),
        defaultDuration: z.number().int().optional().describe("Default spot duration in seconds"),
        defaultTransition: z.enum(["none","fade","fade-out-in","zoom-move","zoom-move-vert","left","right","top","bottom"]).optional(),
        isRandom: z.boolean().optional().describe("Shuffle playback order"),
        isActive: z.boolean().optional(),
        isScheduled: z.boolean().optional(),
        spotsDisabledByDefault: z.boolean().optional(),
        ...instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ instance, ...params }) => {
      try {
        const data = await registry.resolve(instance).post("/playlists/new", params);
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_edit_playlist",
    {
      title: "Edit Playlist",
      description: `Edits an existing playlist by playlistId. Only supply fields to change.

Editable: name, defaultDuration, defaultTransition, isRandom, isActive, isScheduled,
spotsDisabledByDefault, alwaysDownload.

Returns the edited playlistId.`,
      inputSchema: {
        playlistId: z.string().describe("ID of the playlist to edit"),
        name: z.string().optional(),
        defaultDuration: z.number().int().optional(),
        defaultTransition: z.enum(["none","fade","fade-out-in","zoom-move","zoom-move-vert","left","right","top","bottom"]).optional(),
        isRandom: z.boolean().optional(),
        isActive: z.boolean().optional(),
        isScheduled: z.boolean().optional(),
        spotsDisabledByDefault: z.boolean().optional(),
        alwaysDownload: z.boolean().optional(),
        ...instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ playlistId, instance, ...fields }) => {
      try {
        const body = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
        const data = await registry.resolve(instance).put(`/playlists/edit/${playlistId}`, body);
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_delete_playlist",
    {
      title: "Delete Playlist",
      description: `Permanently deletes a playlist by playlistId. This action cannot be undone.

Returns the deletedPlaylistId on success.`,
      inputSchema: {
        playlistId: z.string().describe("ID of the playlist to delete"),
        ...instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ playlistId, instance }) => {
      try {
        const data = await registry.resolve(instance).delete(`/playlists/delete/${playlistId}`, undefined, { playlistId });
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_clear_playlist",
    {
      title: "Clear Playlist Spots",
      description: `Removes all spots (nodes) from a playlist without deleting the playlist itself.

Returns nodesDropped count.`,
      inputSchema: {
        playlistId: z.string().describe("ID of the playlist to clear"),
        ...instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ playlistId, instance }) => {
      try {
        const data = await registry.resolve(instance).post(`/playlists/clear/${playlistId}`, undefined, { playlistId });
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_prune_playlist",
    {
      title: "Prune Expired Playlist Spots",
      description: `Removes all expired spots from a playlist (spots past their validTo date).

Set pruneAll=true to also remove disabled spots.
Returns nodesDropped count.`,
      inputSchema: {
        playlistId: z.string().describe("ID of the playlist to prune"),
        pruneAll: z.boolean().optional().describe("Also remove disabled spots (default: false)"),
        ...instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ playlistId, pruneAll, instance }) => {
      try {
        const data = await registry.resolve(instance).post(
          `/playlists/prune/${playlistId}`,
          pruneAll !== undefined ? { pruneAll } : undefined,
          { playlistId }
        );
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );
}

export function registerNodeTools(server: McpServer, registry: ClientRegistry): void {
  server.registerTool(
    "sklera_list_nodes",
    {
      title: "List Playlist Nodes (Spots)",
      description: `Returns all spots (nodes) for a given playlist.

Each node includes: _id, playlistId, itemId, position, duration, disabled,
validFrom, validTo, validWeekdays, validStartTime, validEndTime, transition, renderImage.
Use _id as nodeId in edit/delete node tools.`,
      inputSchema: {
        playlistId: z.string().describe("ID of the playlist to get spots from"),
        ...instanceField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ playlistId, instance }) => {
      try {
        const data = await registry.resolve(instance).get("/nodes/list", { playlistId });
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_add_node",
    {
      title: "Add Node (Spot) to Playlist",
      description: `Adds a content item as a spot (node) to an existing playlist.

Required: playlistId, itemId.
Optional scheduling: validFrom/validTo (ISO date-time), validWeekdays (1=Mon..7=Sun),
validStartTime/validEndTime (minutes of day, e.g. 540=09:00), duration (seconds),
validRepeatDays, validRepeatMonths.

Returns the new nodeId.`,
      inputSchema: {
        playlistId: z.string().describe("Target playlist ID"),
        itemId: z.string().describe("Library item ID to add as a spot"),
        position: z.number().int().optional().describe("Index position in playlist (0-based)"),
        duration: z.number().int().optional().describe("Display duration in seconds"),
        transition: z.enum(["none","fade","fade-out-in","zoom-move","zoom-move-vert","left","right","top","bottom"]).optional(),
        validFrom: z.string().optional().describe("ISO 8601 date-time, e.g. 2024-01-01T00:00:00.000Z"),
        validTo: z.string().optional().describe("ISO 8601 date-time"),
        validWeekdays: z.array(z.number().int().min(1).max(7)).optional().describe("1=Mon, 7=Sun"),
        validStartTime: z.number().int().optional().describe("Minutes from midnight, e.g. 540 = 09:00"),
        validEndTime: z.number().int().optional().describe("Minutes from midnight, e.g. 1080 = 18:00"),
        disabled: z.boolean().optional(),
        ...instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ instance, ...params }) => {
      try {
        const body = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
        const data = await registry.resolve(instance).post("/nodes/new", body);
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_edit_node",
    {
      title: "Edit Node (Spot)",
      description: `Edits an existing playlist spot (node) by nodeId. Only supply fields to change.

Editable: itemId, position, duration, transition, renderImage, validFrom, validTo,
validWeekdays, validStartTime, validEndTime, disabled.`,
      inputSchema: {
        nodeId: z.string().describe("ID of the node to edit"),
        itemId: z.string().optional(),
        position: z.number().int().optional(),
        duration: z.number().int().optional().describe("In seconds"),
        transition: z.enum(["none","fade","fade-out-in","zoom-move","zoom-move-vert","left","right","top","bottom"]).optional(),
        validFrom: z.string().optional().describe("ISO 8601 date-time"),
        validTo: z.string().optional().describe("ISO 8601 date-time"),
        validWeekdays: z.array(z.number().int().min(1).max(7)).optional(),
        validStartTime: z.number().int().optional().describe("Minutes from midnight"),
        validEndTime: z.number().int().optional().describe("Minutes from midnight"),
        disabled: z.boolean().optional(),
        ...instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ nodeId, instance, ...fields }) => {
      try {
        const body = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
        const data = await registry.resolve(instance).put(`/nodes/edit/${nodeId}`, body);
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_delete_node",
    {
      title: "Delete Node (Spot)",
      description: `Permanently removes a spot (node) from a playlist by nodeId.

Returns the deletedNodeId on success.`,
      inputSchema: {
        nodeId: z.string().describe("ID of the node to delete"),
        ...instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ nodeId, instance }) => {
      try {
        const data = await registry.resolve(instance).delete(`/nodes/delete/${nodeId}`, undefined, { nodeId });
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );
}
