import { describe, it, expect, vi } from "vitest";
import { registerItemTools, registerMessageTools } from "./content.js";

/**
 * These tools forward their parameters into the request body via a spread
 * ({ instance, ...params }). The tests guard the two things that can go wrong:
 *  - the instance selector must route the client but NEVER reach the API body
 *  - the named instance must be resolved against the registry
 */
type Handler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;

function setup(register: (server: never, registry: never) => void) {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: Handler) => {
      handlers.set(name, handler);
    },
  };
  const client = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
  const registry = { resolve: vi.fn(() => client) };
  register(server as never, registry as never);
  return { handlers, client, registry };
}

describe("sklera_create_message", () => {
  it("strips the instance selector from the posted body", async () => {
    // Arrange
    const { handlers, client, registry } = setup(registerMessageTools);
    client.post.mockResolvedValue({ id: "m1" });

    // Act
    await handlers.get("sklera_create_message")!({
      channelId: "c1",
      screens: ["s1"],
      text: "Hallo",
      enabled: true,
      instance: "radiomax",
    });

    // Assert
    expect(registry.resolve).toHaveBeenCalledWith("radiomax");
    expect(client.post).toHaveBeenCalledWith("/messages/new", {
      channelId: "c1",
      screens: ["s1"],
      text: "Hallo",
      enabled: true,
    });
    // The body must not carry the routing-only field.
    const body = client.post.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("instance");
  });
});

describe("sklera_list_items", () => {
  it("routes the named instance and keeps instance out of the query params", async () => {
    // Arrange
    const { handlers, client, registry } = setup(registerItemTools);
    client.get.mockResolvedValue([]);

    // Act
    await handlers.get("sklera_list_items")!({
      channelId: "c1",
      recursive: true,
      instance: "radiomax",
    });

    // Assert
    expect(registry.resolve).toHaveBeenCalledWith("radiomax");
    expect(client.get).toHaveBeenCalledWith("/items/list", { channelId: "c1", recursive: true });
    const params = client.get.mock.calls[0][1] as Record<string, unknown>;
    expect(params).not.toHaveProperty("instance");
  });
});
