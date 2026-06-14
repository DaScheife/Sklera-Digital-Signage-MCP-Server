import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatToolError, successText } from "../services/client.js";
import { ClientRegistry } from "../services/registry.js";
import { instanceField } from "./shared.js";

/**
 * Tools for the Sklera Roommanager module
 * (basePath: /channelApi/roomManager).
 *
 * Rooms create/update/delete use JSON bodies; events use form-urlencoded
 * bodies. All calls authenticate via the apiToken query parameter, handled
 * centrally in SkleraClient.roomRequest().
 */

// Shared room property shape (Roommanager roomData).
const roomCreateShape = {
  name: z.string().describe("Room name"),
  screens: z.array(z.string()).optional().describe("Screen IDs attached to this room"),
  inkLabels: z.array(z.string()).optional().describe("Imagotag eInk label IDs attached to this room"),
  customText: z.string().optional(),
  customText2: z.string().optional(),
  roomColor: z.string().optional().describe("Optional hex color of the room"),
  sharedChannelIds: z
    .array(z.string())
    .optional()
    .describe("Channel IDs where this room is made available as well"),
  building: z.string().optional(),
  buildingWing: z.string().optional(),
  buildingLevel: z.string().optional(),
  roomCapacity: z.number().int().optional(),
  roomCustomId: z.string().optional(),
};

const roomCreateObject = z.object(roomCreateShape);
const roomUpdateObject = z
  .object({ _id: z.string().describe("Room ID"), ...roomCreateShape })
  .extend({ name: z.string().optional().describe("Room name") });

export function registerRoomManagerTools(server: McpServer, registry: ClientRegistry): void {
  // ----- Rooms -----

  server.registerTool(
    "sklera_list_rooms",
    {
      title: "List Rooms",
      description: `Fetches all rooms for the channel associated with the API token (Roommanager module).

Each room includes: _id, name, channelId, userId, optional calendar bindings
(exchange/google), roomCustomId, customText, customText2, building, buildingWing,
buildingLevel, roomCapacity. Use the returned _id as roomId in event tools.`,
      inputSchema: { ...instanceField },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ instance }) => {
      try {
        const client = registry.resolve(instance);
        const data = await client.roomRequest({ method: "get", path: "/rooms" });
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_create_rooms",
    {
      title: "Create Rooms",
      description: `Creates one or multiple rooms (Roommanager module).

Each room requires at least a name. Returns a message, an errors array and the
list of created room IDs.`,
      inputSchema: {
        rooms: z.array(roomCreateObject).min(1).describe("Array of room objects to create"),
        ...instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ rooms, instance }) => {
      try {
        const client = registry.resolve(instance);
        const data = await client.roomRequest({ method: "post", path: "/rooms", jsonBody: { rooms } });
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_update_rooms",
    {
      title: "Update Rooms (bulk)",
      description: `Bulk-updates multiple rooms (Roommanager module).

Each room object requires _id plus at least one other property to change.`,
      inputSchema: {
        rooms: z.array(roomUpdateObject).min(1).describe("Array of room objects to update; each requires _id"),
        ...instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ rooms, instance }) => {
      try {
        const client = registry.resolve(instance);
        const data = await client.roomRequest({ method: "put", path: "/rooms", jsonBody: { rooms } });
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_delete_rooms",
    {
      title: "Delete Rooms (bulk)",
      description: `Permanently deletes multiple rooms by ID (Roommanager module). This cannot be undone.`,
      inputSchema: {
        roomIds: z.array(z.string()).min(1).describe("Room IDs to delete"),
        ...instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ roomIds, instance }) => {
      try {
        const client = registry.resolve(instance);
        const data = await client.roomRequest({ method: "delete", path: "/rooms", jsonBody: { roomIds } });
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_edit_room",
    {
      title: "Edit Room",
      description: `Edits a single room identified by roomId (Roommanager module). At least one field must be set.`,
      inputSchema: {
        roomId: z.string().describe("Room ID to edit"),
        name: z.string().optional().describe("Room name"),
        screens: z.array(z.string()).optional().describe("Screen IDs attached to this room"),
        inkLabels: z.array(z.string()).optional().describe("Imagotag eInk label IDs"),
        customText: z.string().optional(),
        customText2: z.string().optional(),
        roomColor: z.string().optional().describe("Optional hex color of the room"),
        sharedChannelIds: z.array(z.string()).optional(),
        building: z.string().optional(),
        buildingWing: z.string().optional(),
        buildingLevel: z.string().optional(),
        roomCapacity: z.number().int().optional(),
        roomCustomId: z.string().optional(),
        ...instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ roomId, instance, ...fields }) => {
      try {
        const client = registry.resolve(instance);
        const body = Object.fromEntries(
          Object.entries(fields).filter(([, v]) => v !== undefined)
        );
        if (Object.keys(body).length === 0) {
          throw new Error("At least one field must be set to edit a room.");
        }
        const data = await client.roomRequest({
          method: "put",
          path: `/room/${encodeURIComponent(roomId)}`,
          jsonBody: body,
        });
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_delete_room",
    {
      title: "Delete Room",
      description: `Permanently deletes a single room by ID (Roommanager module). This cannot be undone.`,
      inputSchema: {
        roomId: z.string().describe("Room ID to remove"),
        ...instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ roomId, instance }) => {
      try {
        const client = registry.resolve(instance);
        const data = await client.roomRequest({
          method: "delete",
          path: `/room/${encodeURIComponent(roomId)}`,
        });
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  // ----- Events -----

  server.registerTool(
    "sklera_list_events",
    {
      title: "List Events",
      description: `Fetches all events for the channel (Roommanager module).

Optionally filter by dateBegin and/or dateEnd (ISO 8601). dateBegin returns
events beginning after the given date; dateEnd returns events beginning before it.`,
      inputSchema: {
        dateBegin: z.string().optional().describe("ISO date; only events beginning after this date"),
        dateEnd: z.string().optional().describe("ISO date; only events beginning before this date"),
        ...instanceField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ dateBegin, dateEnd, instance }) => {
      try {
        const client = registry.resolve(instance);
        const query: Record<string, unknown> = {};
        if (dateBegin) query.dateBegin = dateBegin;
        if (dateEnd) query.dateEnd = dateEnd;
        const data = await client.roomRequest({ method: "get", path: "/events", query });
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_create_event",
    {
      title: "Create Event",
      description: `Creates a new event/appointment (Roommanager module).

title, begin, end and roomId are required. begin/end must be ISO 8601 dates
(e.g. 2026-06-08T10:30:33.143Z). Use rooms for multiple room IDs in addition to
roomId. Returns the new event id.`,
      inputSchema: {
        title: z.string().describe("Title of the event/appointment"),
        begin: z.string().describe("ISO 8601 start date-time"),
        end: z.string().describe("ISO 8601 end date-time"),
        roomId: z.string().describe("Room ID; use rooms for multiple room IDs"),
        description: z.string().optional(),
        rooms: z.array(z.string()).optional().describe("Additional room IDs"),
        organizer: z.string().optional(),
        location: z.string().optional(),
        externalId: z.string().optional().describe("3rd party ID"),
        ...instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ instance, ...fields }) => {
      try {
        const client = registry.resolve(instance);
        const data = await client.roomRequest({ method: "post", path: "/event", formBody: fields });
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_update_event",
    {
      title: "Update Event",
      description: `Updates an existing event by eventId (Roommanager module). All content fields are optional; supply only what should change. begin/end must be ISO 8601.`,
      inputSchema: {
        eventId: z.string().describe("ID of the event to edit"),
        title: z.string().optional(),
        description: z.string().optional(),
        begin: z.string().optional().describe("ISO 8601 start date-time"),
        end: z.string().optional().describe("ISO 8601 end date-time"),
        roomId: z.string().optional().describe("Room ID; use rooms for multiple room IDs"),
        rooms: z.array(z.string()).optional().describe("Room IDs"),
        organizer: z.string().optional(),
        location: z.string().optional(),
        externalId: z.string().optional().describe("3rd party ID"),
        ...instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ eventId, instance, ...fields }) => {
      try {
        const client = registry.resolve(instance);
        const formBody = Object.fromEntries(
          Object.entries(fields).filter(([, v]) => v !== undefined)
        );
        const data = await client.roomRequest({
          method: "put",
          path: `/event/${encodeURIComponent(eventId)}`,
          formBody,
        });
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_delete_event",
    {
      title: "Delete Event",
      description: `Permanently deletes an event by eventId (Roommanager module). This cannot be undone.`,
      inputSchema: {
        eventId: z.string().describe("ID of the event to delete"),
        ...instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ eventId, instance }) => {
      try {
        const client = registry.resolve(instance);
        const data = await client.roomRequest({
          method: "delete",
          path: `/event/${encodeURIComponent(eventId)}`,
        });
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_delete_events_before",
    {
      title: "Delete Outdated Events",
      description: `Removes all events older than the given date (Roommanager module). This cannot be undone. Returns the number of deleted events.`,
      inputSchema: {
        date: z.string().describe("ISO 8601 date; events older than this are deleted"),
        ...instanceField,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ date, instance }) => {
      try {
        const client = registry.resolve(instance);
        const data = await client.roomRequest({
          method: "post",
          path: "/eventsDeleteBefore",
          formBody: { date },
        });
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );
}
