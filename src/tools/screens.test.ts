import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerScreenTools } from "./screens.js";
import { successText } from "../services/client.js";

/**
 * Test helpers
 * ------------
 * registerScreenTools(server, client) expects two collaborators we don't want
 * the real versions of:
 *  - a McpServer  -> we fake it so we can capture each tool's handler by name
 *  - a SkleraClient -> we fake get/post/put so no HTTP request ever happens
 */
type Handler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;

function setup() {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: Handler) => {
      handlers.set(name, handler);
    },
  };
  const client = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  };
  // Tools now receive the ClientRegistry and resolve a client per call. The
  // fake registry hands back the same fake client and records the instance.
  const registry = {
    resolve: vi.fn(() => client),
  };

  // The casts tell TypeScript "trust me, these stand in for the real types".
  registerScreenTools(server as never, registry as never);

  return { handlers, client, registry };
}

describe("sklera_list_screens", () => {
  it("calls the /screens/list endpoint and returns a paginated envelope of core fields", async () => {
    // Arrange
    const { handlers, client } = setup();
    client.get.mockResolvedValue({ screens: [{ _id: "s1", name: "Lobby" }] });

    // Act
    const result = await handlers.get("sklera_list_screens")!({});

    // Assert
    expect(client.get).toHaveBeenCalledWith("/screens/list");
    const payload = JSON.parse(result.content[0].text);
    expect(payload.total).toBe(1);
    expect(payload.returned).toBe(1);
    expect(payload.offset).toBe(0);
    expect(payload.limit).toBeNull();
    expect(payload.screens).toEqual([{ _id: "s1", name: "Lobby" }]);
    expect(result.isError).toBeUndefined();
  });

  it('defaults to core projection: drops platformInfo/networkInfo, derives model and ip', async () => {
    // Arrange
    const { handlers, client } = setup();
    client.get.mockResolvedValue({
      screens: [
        {
          _id: "s1",
          name: "Lobby",
          channelId: "c1",
          platformInfo: { modelName: "43UM5N-HP", serialNumber: "secret" },
          networkInfo: { wifi: { ipAddress: "192.168.2.35" } },
          operatingTimes: { isActive: true },
        },
      ],
    });

    // Act
    const result = await handlers.get("sklera_list_screens")!({});

    // Assert
    const screen = JSON.parse(result.content[0].text).screens[0];
    expect(screen.model).toBe("43UM5N-HP");
    expect(screen.ip).toBe("192.168.2.35");
    expect(screen.platformInfo).toBeUndefined();
    expect(screen.networkInfo).toBeUndefined();
    expect(screen.operatingTimes).toBeUndefined();
  });

  it('fields="full" returns the complete unprojected objects', async () => {
    // Arrange
    const { handlers, client } = setup();
    const full = { _id: "s1", platformInfo: { modelName: "X" }, networkInfo: { type: "wifi" } };
    client.get.mockResolvedValue({ screens: [full] });

    // Act
    const result = await handlers.get("sklera_list_screens")!({ fields: "full" });

    // Assert
    expect(JSON.parse(result.content[0].text).screens[0]).toEqual(full);
  });

  it("filters by channelId client-side", async () => {
    // Arrange
    const { handlers, client } = setup();
    client.get.mockResolvedValue({
      screens: [
        { _id: "s1", channelId: "c1" },
        { _id: "s2", channelId: "c2" },
      ],
    });

    // Act
    const result = await handlers.get("sklera_list_screens")!({ channelId: "c2" });

    // Assert
    const payload = JSON.parse(result.content[0].text);
    expect(payload.total).toBe(1);
    expect(payload.screens.map((s: { _id: string }) => s._id)).toEqual(["s2"]);
  });

  it("applies limit and offset for pagination", async () => {
    // Arrange
    const { handlers, client } = setup();
    client.get.mockResolvedValue({
      screens: [{ _id: "s1" }, { _id: "s2" }, { _id: "s3" }, { _id: "s4" }],
    });

    // Act
    const result = await handlers.get("sklera_list_screens")!({ limit: 2, offset: 1 });

    // Assert
    const payload = JSON.parse(result.content[0].text);
    expect(payload.total).toBe(4);
    expect(payload.offset).toBe(1);
    expect(payload.limit).toBe(2);
    expect(payload.screens.map((s: { _id: string }) => s._id)).toEqual(["s2", "s3"]);
  });

  it("returns an error result when the client throws", async () => {
    // Arrange
    const { handlers, client } = setup();
    client.get.mockRejectedValue(new Error("Sklera API error 500: boom"));

    // Act
    const result = await handlers.get("sklera_list_screens")!({});

    // Assert
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: Sklera API error 500: boom");
  });
});

describe("sklera_send_screen_command", () => {
  it("rejects when neither screenId nor screenName is given (no API call)", async () => {
    // Arrange
    const { handlers, client } = setup();

    // Act
    const result = await handlers.get("sklera_send_screen_command")!({
      cmd: "viewer_next",
    });

    // Assert
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("either screenId or screenName");
    expect(client.post).not.toHaveBeenCalled();
  });

  it("posts the command with the screen id when provided", async () => {
    // Arrange
    const { handlers, client } = setup();
    client.post.mockResolvedValue({ success: true });

    // Act
    await handlers.get("sklera_send_screen_command")!({
      screenId: "s1",
      cmd: "device_restart",
    });

    // Assert
    expect(client.post).toHaveBeenCalledWith("/screens/sendCmd", {
      cmd: "device_restart",
      id: "s1",
    });
  });

  it("does not forward the instance selector into the command body", async () => {
    // Arrange
    const { handlers, client, registry } = setup();
    client.post.mockResolvedValue({ success: true });

    // Act
    await handlers.get("sklera_send_screen_command")!({
      screenId: "s1",
      cmd: "device_restart",
      instance: "radiomax",
    });

    // Assert: instance routes the client but never reaches the API body.
    expect(registry.resolve).toHaveBeenCalledWith("radiomax");
    expect(client.post).toHaveBeenCalledWith("/screens/sendCmd", {
      cmd: "device_restart",
      id: "s1",
    });
  });
});

describe("sklera_screen_connection_status", () => {
  const groups = [
    { channelId: "c1", channelName: "One", screenState: [{ _id: "a" }] },
    { channelId: "c2", channelName: "Two", screenState: [{ _id: "b" }] },
  ];

  it("returns all channel groups when no channelId is given", async () => {
    // Arrange
    const { handlers, client } = setup();
    client.get.mockResolvedValue(groups);

    // Act
    const result = await handlers.get("sklera_screen_connection_status")!({});

    // Assert: the API is called without params; full set is returned.
    expect(client.get).toHaveBeenCalledWith("/screens/getConnectionStatus");
    expect(JSON.parse(result.content[0].text)).toEqual(groups);
  });

  it("filters client-side so two different channelIds yield different results", async () => {
    // Arrange
    const { handlers, client } = setup();
    client.get.mockResolvedValue(groups);

    // Act
    const r1 = await handlers.get("sklera_screen_connection_status")!({ channelId: "c1" });
    const r2 = await handlers.get("sklera_screen_connection_status")!({ channelId: "c2" });

    // Assert
    const p1 = JSON.parse(r1.content[0].text);
    const p2 = JSON.parse(r2.content[0].text);
    expect(p1).toEqual([groups[0]]);
    expect(p2).toEqual([groups[1]]);
    expect(p1).not.toEqual(p2);
  });
});

describe("instance routing", () => {
  it("resolves the named instance for list_screens", async () => {
    // Arrange
    const { handlers, client, registry } = setup();
    client.get.mockResolvedValue([]);

    // Act
    await handlers.get("sklera_list_screens")!({ instance: "radiomax" });

    // Assert
    expect(registry.resolve).toHaveBeenCalledWith("radiomax");
    expect(client.get).toHaveBeenCalledWith("/screens/list");
  });

  it("resolves the default instance when none is given", async () => {
    // Arrange
    const { handlers, client, registry } = setup();
    client.get.mockResolvedValue([]);

    // Act
    await handlers.get("sklera_list_screens")!({});

    // Assert: resolve(undefined) → default instance.
    expect(registry.resolve).toHaveBeenCalledWith(undefined);
  });
});
