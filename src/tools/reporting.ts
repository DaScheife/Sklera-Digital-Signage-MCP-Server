import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatToolError, successText } from "../services/client.js";
import { ClientRegistry } from "../services/registry.js";
import { instanceField } from "./shared.js";

const ReportingBaseSchema = {
  channelId: z.string().describe("Channel ID to report on"),
  dateBegin: z.string().optional().describe("ISO 8601 UTC start date (ignored when offset is used)"),
  dateEnd: z.string().optional().describe("ISO 8601 UTC end date (ignored when offset is used)"),
  dayOffset: z.number().optional().describe("0=today, 1=yesterday, etc. Overrides dateBegin/dateEnd"),
  weekOffset: z.number().optional().describe("0=current week, 1=last week, etc."),
  monthOffset: z.number().optional().describe("0=current month, 1=last month, etc."),
  itemIds: z.array(z.string()).optional().describe("Filter by specific item IDs"),
  screenIds: z.array(z.string()).optional().describe("Filter by specific screen IDs"),
  ...instanceField,
};

function buildReportBody(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
}

export function registerReportingTools(server: McpServer, registry: ClientRegistry): void {
  server.registerTool(
    "sklera_reporting_played_live",
    {
      title: "Reporting: Played Items (Raw/Live)",
      description: `Returns raw play-log entries for the last 7 days max.

Each entry includes: time (UTC), itemName, screenName, channelName, playlistName, duration, platform.
Filter by itemIds or screenIds to narrow results.
Use dayOffset/weekOffset/monthOffset for convenient relative date ranges.`,
      inputSchema: ReportingBaseSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ instance, ...params }) => {
      try {
        const data = await registry.resolve(instance).post("/reporting/itemPlayed/live", buildReportBody(params as Record<string, unknown>));
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_reporting_played_hourly",
    {
      title: "Reporting: Played Items (Hourly Aggregated)",
      description: `Returns play-log data aggregated by hour for the last 14 days max.

Each entry includes: time, itemName, screenName, channelName, count_played, sum_duration.
Useful for identifying peak playback hours per content or screen.`,
      inputSchema: ReportingBaseSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ instance, ...params }) => {
      try {
        const data = await registry.resolve(instance).post("/reporting/itemPlayed/hourly", buildReportBody(params as Record<string, unknown>));
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_reporting_played_daily",
    {
      title: "Reporting: Played Items (Daily Aggregated)",
      description: `Returns play-log data aggregated by day for the last 364 days max.

Each entry includes: time, itemName, screenName, channelName, count_played, sum_duration.
Useful for trend analysis and monthly performance reports.`,
      inputSchema: ReportingBaseSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ instance, ...params }) => {
      try {
        const data = await registry.resolve(instance).post("/reporting/itemPlayed/daily", buildReportBody(params as Record<string, unknown>));
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_reporting_touch_live",
    {
      title: "Reporting: Touch Interactions (Raw)",
      description: `Returns raw touch/interaction log entries for the last 7 days max.

Each entry includes: time, action (touch action type), itemName, screenName, channelName, playlistName.
Useful for auditing interactive kiosk usage.`,
      inputSchema: ReportingBaseSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ instance, ...params }) => {
      try {
        const data = await registry.resolve(instance).post("/reporting/touch/live", buildReportBody(params as Record<string, unknown>));
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );

  server.registerTool(
    "sklera_reporting_touch_daily",
    {
      title: "Reporting: Touch Interactions (Daily Aggregated)",
      description: `Returns daily aggregated touch/interaction data for the last 364 days max.

Each entry includes: time, action, actions (total count), screenName, channelName.
Useful for measuring engagement trends on interactive screens.`,
      inputSchema: ReportingBaseSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ instance, ...params }) => {
      try {
        const data = await registry.resolve(instance).post("/reporting/touch/daily", buildReportBody(params as Record<string, unknown>));
        return { content: [{ type: "text", text: successText(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
      }
    }
  );
}
