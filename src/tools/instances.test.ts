import { describe, it, expect, vi } from "vitest";
import { registerInstanceTools } from "./instances.js";

type Handler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;

function parse(result: { content: { text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

function setup(opts?: { staticNames?: string[] }) {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: Handler) => {
      handlers.set(name, handler);
    },
  };
  const staticNames = opts?.staticNames ?? ["radiomax", "my"];
  const client = { get: vi.fn() };
  const registry = {
    resolve: vi.fn(() => client),
    staticInstanceNames: vi.fn(() => staticNames),
    staticInstances: vi.fn(() =>
      staticNames.map((n) => ({ name: n, baseUrl: `https://${n}.example`, tokenMasked: "…1234" }))
    ),
    defaultInstanceName: vi.fn(() => staticNames[0]),
    evictDynamicClient: vi.fn(),
  };
  const store = {
    has: vi.fn(() => false),
    add: vi.fn(),
    remove: vi.fn(() => true),
    list: vi.fn(() => [] as unknown[]),
  };
  registerInstanceTools(server as never, registry as never, store as never);
  return { handlers, client, registry, store };
}

describe("sklera_add_instance", () => {
  it("adds a valid dynamic instance and confirms immediate availability", async () => {
    const { handlers, store } = setup();
    const res = await handlers.get("sklera_add_instance")!({
      name: "radiomax-backup",
      baseUrl: "https://sklera.radiomax.technology/",
      apiToken: "TOK_ABCD",
      label: "Backup",
    });
    expect(res.isError).toBeUndefined();
    expect(store.add).toHaveBeenCalledTimes(1);
    const addArg = store.add.mock.calls[0][0] as Record<string, unknown>;
    expect(addArg.name).toBe("radiomax-backup");
    expect(addArg.baseUrl).toBe("https://sklera.radiomax.technology"); // trailing slash trimmed
    expect(parse(res).status).toBe("added");
  });

  it("rejects a name colliding with a static instance", async () => {
    const { handlers, store } = setup({ staticNames: ["radiomax"] });
    const res = await handlers.get("sklera_add_instance")!({
      name: "radiomax",
      baseUrl: "https://x.example",
      apiToken: "T",
    });
    expect(res.isError).toBe(true);
    expect(store.add).not.toHaveBeenCalled();
  });

  it("rejects an invalid name and an invalid url", async () => {
    const { handlers, store } = setup();
    const badName = await handlers.get("sklera_add_instance")!({
      name: "bad name!",
      baseUrl: "https://x.example",
      apiToken: "T",
    });
    expect(badName.isError).toBe(true);

    const badUrl = await handlers.get("sklera_add_instance")!({
      name: "ok",
      baseUrl: "not-a-url",
      apiToken: "T",
    });
    expect(badUrl.isError).toBe(true);
    expect(store.add).not.toHaveBeenCalled();
  });
});

describe("sklera_list_instances", () => {
  it("lists static and dynamic instances with origin and masked tokens", async () => {
    const { handlers, store } = setup({ staticNames: ["radiomax"] });
    store.list.mockReturnValue([
      {
        name: "radiomax-backup",
        baseUrl: "https://sklera.radiomax.technology",
        label: "Backup",
        tokenMasked: "…WXYZ",
        createdAt: "2026-06-18T00:00:00.000Z",
        updatedAt: "2026-06-18T00:00:00.000Z",
      },
    ]);
    const res = await handlers.get("sklera_list_instances")!({});
    const out = parse(res) as { default: string; instances: Array<Record<string, unknown>> };
    expect(out.default).toBe("radiomax");
    const origins = out.instances.map((i) => i.origin);
    expect(origins).toContain("static");
    expect(origins).toContain("dynamic");
    const dyn = out.instances.find((i) => i.origin === "dynamic")!;
    expect(dyn.tokenMasked).toBe("…WXYZ");
    expect(dyn.shadowedByStatic).toBe(false);
  });
});

describe("sklera_remove_instance", () => {
  it("refuses to remove a static instance and makes no store call", async () => {
    const { handlers, store } = setup({ staticNames: ["radiomax"] });
    const res = await handlers.get("sklera_remove_instance")!({ name: "radiomax" });
    expect(res.isError).toBe(true);
    expect(store.remove).not.toHaveBeenCalled();
  });

  it("removes a dynamic instance locally without any API call", async () => {
    const { handlers, store, registry } = setup({ staticNames: ["radiomax"] });
    const res = await handlers.get("sklera_remove_instance")!({ name: "radiomax-backup" });
    expect(res.isError).toBeUndefined();
    expect(store.remove).toHaveBeenCalledWith("radiomax-backup");
    expect(registry.evictDynamicClient).toHaveBeenCalledWith("radiomax-backup");
    expect(parse(res).status).toBe("removed");
  });
});

describe("sklera_test_instance", () => {
  it("performs a read-only /channels/list and reports count and resellers", async () => {
    const { handlers, client, registry } = setup();
    client.get.mockResolvedValue([
      { _id: "c1", resellerId: "MAXFIVE" },
      { _id: "c2", resellerId: "MAXFIVE" },
      { _id: "c3", resellerId: "OTHER" },
    ]);
    const res = await handlers.get("sklera_test_instance")!({ name: "radiomax" });
    expect(registry.resolve).toHaveBeenCalledWith("radiomax");
    expect(client.get).toHaveBeenCalledWith("/channels/list");
    const out = parse(res);
    expect(out.status).toBe("ok");
    expect(out.channelCount).toBe(3);
    expect(out.resellerIds).toEqual(["MAXFIVE", "OTHER"]);
  });
});
