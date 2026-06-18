import { describe, it, expect, vi } from "vitest";
import { registerProvisioningTools } from "./provisioning.js";

/**
 * Provisioning tools must be strictly read-only: every call goes through
 * client.get, the instance selector routes but never leaks into query params,
 * and no mutating client method is ever invoked.
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
  const client = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
  const registry = { resolve: vi.fn(() => client) };
  registerProvisioningTools(server as never, registry as never);
  return { handlers, client, registry };
}

describe("sklera_provisioning_list", () => {
  it("issues a GET to /provisioning/list with only defined filters", async () => {
    const { handlers, client, registry } = setup();
    client.get.mockResolvedValue([{ channelId: "c1" }]);

    await handlers.get("sklera_provisioning_list")!({
      instance: "radiomax",
      channelName: "BILLA",
      email: undefined,
    });

    expect(registry.resolve).toHaveBeenCalledWith("radiomax");
    expect(client.get).toHaveBeenCalledWith("/provisioning/list", { channelName: "BILLA" });
    const params = client.get.mock.calls[0][1] as Record<string, unknown>;
    expect(params).not.toHaveProperty("instance");
    expect(params).not.toHaveProperty("email");
    // No mutating method is ever called.
    expect(client.post).not.toHaveBeenCalled();
    expect(client.put).not.toHaveBeenCalled();
    expect(client.delete).not.toHaveBeenCalled();
  });
});

describe("sklera_provisioning_get", () => {
  it("issues a GET to /provisioning/get/{channelId}", async () => {
    const { handlers, client } = setup();
    client.get.mockResolvedValue({ channelId: "c9" });

    await handlers.get("sklera_provisioning_get")!({ instance: "radiomax", channelId: "c9" });

    expect(client.get).toHaveBeenCalledWith("/provisioning/get/c9");
    expect(client.post).not.toHaveBeenCalled();
    expect(client.put).not.toHaveBeenCalled();
    expect(client.delete).not.toHaveBeenCalled();
  });

  it("url-encodes the channelId", async () => {
    const { handlers, client } = setup();
    client.get.mockResolvedValue({});
    await handlers.get("sklera_provisioning_get")!({ channelId: "a/b c" });
    expect(client.get).toHaveBeenCalledWith("/provisioning/get/a%2Fb%20c");
  });
});
