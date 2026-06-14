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

  // The casts tell TypeScript "trust me, these stand in for the real types".
  registerScreenTools(server as never, client as never);

  return { handlers, client };
}

describe("sklera_list_screens", () => {
  it("calls the /screens/list endpoint and returns the data as text", async () => {
    // Arrange
    const { handlers, client } = setup();
    const apiResponse = [{ _id: "s1", name: "Lobby" }];
    client.get.mockResolvedValue(apiResponse);

    // Act
    const result = await handlers.get("sklera_list_screens")!({});

    // Assert
    expect(client.get).toHaveBeenCalledWith("/screens/list");
    expect(result.content[0].text).toBe(successText(apiResponse));
    expect(result.isError).toBeUndefined();
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
});
