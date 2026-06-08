import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SkleraClient, formatToolError, successText } from "../services/client.js";

export function registerItemTools(server: McpServer, client: SkleraClient): void {
  server.registerTool(
    "sklera_list_items",
    {
      title: "List Library Items",
      description: `Returns all content library items for a channel.

Filterable by itemType (image/video/layout/audio/document/html5/youtube/page/website/font),
folder ID, uploader user ID, or uploadDate (returns items added after this date).
Set recursive=true (default) to include subfolders.

Each item includes: _id, name, type, extension, fileSize, uploadedAt, folder, meta (tags, categories, url).`,
      inputSchema: {
        channelId: z.string().describe("Channel ID to list items from"),
        itemType: z.array(z.enum(["image","video","layout","audio","document","html5","youtube","page","website","font"])).optional(),
        recursive: z.boolean().default(true).describe("Include subfolders (default: true)"),
        folder: z.string().optional().describe("Limit to this folder ID and its subfolders"),
        uploadDate: z.string().optional().describe("ISO 8601: return items added after this date"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ channelId, itemType, recursive, folder, uploadDate }) => {
      try {
        const params: Record<string, unknown> = { channelId, recursive };
        if (itemType?.length) params.itemType = itemType.join(",");
        if (folder) params.folder = folder;
        if (uploadDate) params.uploadDate = uploadDate;
        const data = await client.get("/items/list", params);
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_get_item",
    {
      title: "Get Library Item",
      description: `Returns full details for a single library item by itemId.

Includes: _id, name, type, mimeType, extension, size, created, tags, categories,
thumbUrl, rawUrl, imageUrl, versions (for images).`,
      inputSchema: {
        itemId: z.string().describe("ID of the library item"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ itemId }) => {
      try {
        const data = await client.get(`/items/get/${itemId}`);
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_replace_item_by_url",
    {
      title: "Replace Item Content by URL",
      description: `Replaces the content of an existing library item with a file fetched from a public URL.

The URL must be publicly accessible. Optionally provide mimeType or extension as fallback
if the server doesn't return a correct Content-Type header.

Returns the updated itemId.`,
      inputSchema: {
        itemId: z.string().describe("ID of the item to replace"),
        url: z.string().url().describe("Public URL of the new content"),
        mimeType: z.string().optional().describe("Fallback MIME type, e.g. image/png"),
        extension: z.string().optional().describe("Fallback extension, e.g. .png"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ itemId, url, mimeType, extension }) => {
      try {
        const body: Record<string, unknown> = { url };
        if (mimeType) body.mimeType = mimeType;
        if (extension) body.extension = extension;
        const data = await client.post(`/items/replace/${itemId}`, body);
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_delete_item",
    {
      title: "Delete Library Item",
      description: `Permanently deletes a library item by itemId. This cannot be undone.

Note: Items that are currently used in playlists may still be referenced after deletion.
Returns the deleted itemId.`,
      inputSchema: {
        itemId: z.string().describe("ID of the item to delete"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ itemId }) => {
      try {
        const data = await client.delete(`/items/delete/${itemId}`);
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_copy_item",
    {
      title: "Copy Library Item",
      description: `Copies an existing library item, optionally to a different channel or folder.

Optional: specify a target channelId (defaults to same channel), folderName, or itemData to override properties.
Returns the new itemId.`,
      inputSchema: {
        itemId: z.string().describe("ID of the item to copy"),
        channelId: z.string().optional().describe("Target channel (defaults to same channel)"),
        folderName: z.string().optional().describe("Target folder name"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ itemId, channelId, folderName }) => {
      try {
        const body: Record<string, unknown> = {};
        if (channelId) body.channelId = channelId;
        if (folderName) body.folderName = folderName;
        const data = await client.post(`/items/copy/${itemId}`, body);
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );
}

export function registerPlayoutTools(server: McpServer, client: SkleraClient): void {
  server.registerTool(
    "sklera_list_playouts",
    {
      title: "List Playouts",
      description: `Returns all playouts, optionally filtered by channelId.

A Playout defines which playlists play on which screens/screen groups.
Each playout includes: id, name, isActive, priority.
Use the id as playoutId in get/edit/delete tools.`,
      inputSchema: {
        channelId: z.string().optional().describe("Optional: filter by channel ID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ channelId }) => {
      try {
        const params: Record<string, unknown> = {};
        if (channelId) params.channelId = channelId;
        const data = await client.get("/playouts/list", params);
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_get_playout",
    {
      title: "Get Playout Details",
      description: `Returns full details for a single playout by playoutId.

Includes: name, channelId, isActive, priority, playlists, screens, screenGroups,
screenCategories, timeslots.`,
      inputSchema: {
        playoutId: z.string().describe("ID of the playout"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ playoutId }) => {
      try {
        const data = await client.get(`/playouts/get/${playoutId}`);
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_edit_playout",
    {
      title: "Edit Playout",
      description: `Edits an existing playout. Only supply fields to change.

Editable: name, isActive, priority, screens (array of screen IDs), screenGroups, screenCategories, playlists.
Screen targeting priority: screens > screenCategories > screenGroups.

Returns the updated playoutId.`,
      inputSchema: {
        playoutId: z.string().describe("ID of the playout to edit"),
        name: z.string().optional(),
        isActive: z.boolean().optional(),
        priority: z.number().int().optional(),
        screens: z.array(z.string()).optional().describe("Array of screen IDs"),
        screenGroups: z.array(z.string()).optional(),
        screenCategories: z.array(z.string()).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ playoutId, ...fields }) => {
      try {
        const body = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
        const data = await client.put(`/playouts/edit/${playoutId}`, body);
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_delete_playout",
    {
      title: "Delete Playout",
      description: `Permanently deletes a playout by playoutId. This cannot be undone.`,
      inputSchema: {
        playoutId: z.string().describe("ID of the playout to delete"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ playoutId }) => {
      try {
        const data = await client.delete(`/playouts/delete/${playoutId}`, undefined, { playoutId });
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );
}

export function registerMessageTools(server: McpServer, client: SkleraClient): void {
  server.registerTool(
    "sklera_list_messages",
    {
      title: "List Messages",
      description: `Returns all existing ticker/overlay messages.

Each message includes: channelId, screens, allScreens, text, startsAt, endsAt, enabled, duration.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const data = await client.get("/messages/list");
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_create_message",
    {
      title: "Create Message",
      description: `Creates a new ticker/overlay message displayed on screens.

Required: channelId, screens (array of screen IDs), text.
Set allScreens=true to target all screens in the channel.
Use startsAt/endsAt (ISO 8601) to schedule the message.
hasDuration=true with duration (seconds) limits display time per screen.

Returns the new messageId.`,
      inputSchema: {
        channelId: z.string().describe("Channel ID"),
        screens: z.array(z.string()).describe("Array of screen IDs"),
        text: z.string().describe("Message text to display"),
        allScreens: z.boolean().optional().describe("Target all screens in channel"),
        startsAt: z.string().optional().describe("ISO 8601 start time"),
        endsAt: z.string().optional().describe("ISO 8601 end time"),
        enabled: z.boolean().optional().default(true),
        hasDuration: z.boolean().optional(),
        duration: z.number().int().optional().describe("Display duration in seconds"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      try {
        const body = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
        const data = await client.post("/messages/new", body);
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );
}

export function registerCustomValueTools(server: McpServer, client: SkleraClient): void {
  server.registerTool(
    "sklera_get_custom_values",
    {
      title: "Get Custom Values",
      description: `Returns all custom values (key-value pairs used in dynamic content).

Each entry includes: _id, key, value, parentId, permissions (public/private), isEncrypted.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const data = await client.get("/customValues/get");
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_edit_custom_value",
    {
      title: "Edit Custom Value by ID",
      description: `Updates the value (and optionally permissions) of a custom value by its ID.

Returns the updated custom value object.`,
      inputSchema: {
        customValueId: z.string().describe("ID of the custom value to edit"),
        value: z.string().describe("New value"),
        permissions: z.enum(["public","private"]).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ customValueId, value, permissions }) => {
      try {
        const body: Record<string, unknown> = { value };
        if (permissions) body.permissions = permissions;
        const data = await client.put(`/customValues/edit/${customValueId}`, body);
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );
}
