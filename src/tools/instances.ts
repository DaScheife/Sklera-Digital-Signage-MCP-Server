import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatToolError, successText } from "../services/client.js";
import { ClientRegistry } from "../services/registry.js";
import { DynamicInstanceStore } from "../services/instanceStore.js";

/** Instance names: letters, digits, dash, underscore. Keeps routing unambiguous. */
const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Normalizes a /channels/list response (bare array or { channels: [...] }) to an array. */
function normalizeChannels(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data as Array<Record<string, unknown>>;
  const channels = (data as { channels?: unknown } | null)?.channels;
  return Array.isArray(channels) ? (channels as Array<Record<string, unknown>>) : [];
}

/** Collects the distinct, non-empty resellerId values across a channel list. */
function distinctResellerIds(channels: Array<Record<string, unknown>>): string[] {
  const ids = new Set<string>();
  for (const ch of channels) {
    const rid = ch.resellerId;
    if (typeof rid === "string" && rid.length > 0) ids.add(rid);
  }
  return [...ids];
}

/**
 * Runtime instance management (Muster A).
 *
 * These tools mutate only the connector's own local, encrypted instance store.
 * sklera_remove_instance in particular performs NO Sklera API call and deletes
 * nothing in Sklera; it only forgets a locally added instance. sklera_test_
 * instance issues a single lightweight READ (/channels/list).
 */
export function registerInstanceTools(
  server: McpServer,
  registry: ClientRegistry,
  store: DynamicInstanceStore
): void {
  server.registerTool(
    "sklera_add_instance",
    {
      title: "Add/Update Sklera Instance (runtime)",
      description: `Adds or updates a dynamic Sklera instance in the connector's
local, encrypted store at runtime. The instance becomes usable immediately by
all Sklera data tools via the "instance" parameter — no reconnect or restart.

Validates: name (unique, [A-Za-z0-9_-]), baseUrl (http/https URL), token
(non-empty). The token is stored encrypted at rest and never logged or echoed
back in clear text. A name that collides with a statically configured instance
is rejected (static instances take precedence and cannot be shadowed).`,
      inputSchema: {
        name: z.string().min(1).describe("Unique instance name, e.g. \"radiomax-backup\""),
        baseUrl: z.string().min(1).describe("Sklera base URL, e.g. https://sklera.radiomax.technology"),
        apiToken: z.string().min(1).describe("Sklera apiToken for this instance (stored encrypted)"),
        label: z.string().optional().describe("Optional human-readable label"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name, baseUrl, apiToken, label }) => {
      try {
        if (!NAME_PATTERN.test(name)) {
          throw new Error(
            `Invalid instance name "${name}". Allowed characters: letters, digits, "-", "_".`
          );
        }
        if (registry.staticInstanceNames().includes(name)) {
          throw new Error(
            `Instance name "${name}" is already used by a statically configured instance and cannot be overridden.`
          );
        }
        let parsed: URL;
        try {
          parsed = new URL(baseUrl);
        } catch {
          throw new Error(`baseUrl "${baseUrl}" is not a valid URL.`);
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error(`baseUrl must use http or https, got "${parsed.protocol}".`);
        }
        if (apiToken.trim().length === 0) {
          throw new Error("apiToken must not be empty.");
        }

        const normalizedBaseUrl = baseUrl.trim().replace(/\/$/, "");
        const existed = store.has(name);
        store.add({
          name,
          baseUrl: normalizedBaseUrl,
          apiToken: apiToken.trim(),
          label,
          nowIso: new Date().toISOString(),
        });

        return {
          content: [
            {
              type: "text",
              text: successText({
                status: existed ? "updated" : "added",
                name,
                baseUrl: normalizedBaseUrl,
                label,
                note: "Instance is available immediately via the \"instance\" parameter; no reconnect required.",
              }),
            },
          ],
        };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_list_instances",
    {
      title: "List Sklera Instances",
      description: `Lists all configured Sklera instances — both statically
configured (env/header/OAuth) and dynamically added at runtime. For each:
name, baseUrl, label, origin ("static" | "dynamic"), and a masked token (last
4 characters only). Tokens are never returned in clear text.`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const staticNames = new Set(registry.staticInstanceNames());
        const staticEntries = registry.staticInstances().map((s) => ({
          name: s.name,
          baseUrl: s.baseUrl,
          label: undefined as string | undefined,
          origin: "static" as const,
          tokenMasked: s.tokenMasked,
          isDefault: s.name === registry.defaultInstanceName(),
        }));
        // Dynamic instances whose name collides with a static one are shadowed
        // and flagged, so the precedence is visible rather than silent.
        const dynamicEntries = store.list().map((d) => ({
          name: d.name,
          baseUrl: d.baseUrl,
          label: d.label,
          origin: "dynamic" as const,
          tokenMasked: d.tokenMasked,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
          shadowedByStatic: staticNames.has(d.name),
        }));

        return {
          content: [
            {
              type: "text",
              text: successText({
                default: registry.defaultInstanceName(),
                instances: [...staticEntries, ...dynamicEntries],
              }),
            },
          ],
        };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_remove_instance",
    {
      title: "Remove Sklera Instance (local only)",
      description: `Removes a DYNAMIC instance from the connector's local store.
This affects only the local connector configuration: it makes NO Sklera API
call and deletes NOTHING in Sklera. Statically configured instances cannot be
removed this way.`,
      inputSchema: {
        name: z.string().min(1).describe("Name of the dynamic instance to forget"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name }) => {
      try {
        if (registry.staticInstanceNames().includes(name)) {
          throw new Error(
            `"${name}" is a statically configured instance and cannot be removed at runtime.`
          );
        }
        const removed = store.remove(name);
        registry.evictDynamicClient(name);
        return {
          content: [
            {
              type: "text",
              text: successText({
                status: removed ? "removed" : "not_found",
                name,
                note: "Local connector configuration only — no Sklera API call was made; nothing was deleted in Sklera.",
              }),
            },
          ],
        };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_test_instance",
    {
      title: "Test Sklera Instance",
      description: `Verifies the token for a configured instance (static or
dynamic) with a single lightweight READ call (/channels/list) and reports
success, the reseller id(s) and the number of accessible channels. Read-only.`,
      inputSchema: {
        name: z.string().min(1).describe("Name of the instance to test"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name }) => {
      try {
        const client = registry.resolve(name);
        const data = await client.get("/channels/list");
        const channels = normalizeChannels(data);
        return {
          content: [
            {
              type: "text",
              text: successText({
                status: "ok",
                name,
                channelCount: channels.length,
                resellerIds: distinctResellerIds(channels),
              }),
            },
          ],
        };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );
}
