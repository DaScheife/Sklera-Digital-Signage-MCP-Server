import { describe, it, expect } from "vitest";
import { buildRegistryFromInstances } from "./registry.js";
import type { InstanceConfig } from "./registry.js";

describe("buildRegistryFromInstances", () => {
  it("builds a registry and honours the chosen default", () => {
    // Arrange
    const payload = {
      default: "onprem",
      instances: {
        my: { baseUrl: "https://my.sklera.tv", apiToken: "TOKEN_A" },
        onprem: { baseUrl: "https://sklera.example.net", apiToken: "TOKEN_B" },
      },
    };

    // Act
    const registry = buildRegistryFromInstances(payload, "OAuth token instances");

    // Assert
    expect(registry.defaultInstanceName()).toBe("onprem");
    expect(registry.names().sort()).toEqual(["my", "onprem"]);
    // resolve() returns a client per instance and falls back to the default.
    expect(registry.resolve("my")).not.toBe(registry.resolve("onprem"));
    expect(registry.resolve()).toBe(registry.resolve("onprem"));
  });

  it("falls back to the first instance when no default is given", () => {
    const registry = buildRegistryFromInstances(
      { instances: { only: { baseUrl: "https://my.sklera.tv", apiToken: "T" } } },
      "SKLERA_INSTANCES"
    );
    expect(registry.defaultInstanceName()).toBe("only");
  });

  it("throws (with the source label) when there are no instances", () => {
    expect(() => buildRegistryFromInstances({ instances: {} }, "SKLERA_INSTANCES")).toThrow(
      "SKLERA_INSTANCES contains no instances"
    );
    expect(() => buildRegistryFromInstances({}, "x-sklera-instances header")).toThrow(
      "x-sklera-instances header contains no instances"
    );
  });

  it("throws when an instance is missing baseUrl or apiToken", () => {
    expect(() =>
      buildRegistryFromInstances(
        { instances: { broken: { baseUrl: "https://my.sklera.tv" } as never } },
        "SKLERA_INSTANCES"
      )
    ).toThrow('Instance "broken" must define both baseUrl and apiToken');
  });

  it("rejects resolving an unknown instance name", () => {
    const registry = buildRegistryFromInstances(
      { instances: { my: { baseUrl: "https://my.sklera.tv", apiToken: "T" } } },
      "SKLERA_INSTANCES"
    );
    expect(() => registry.resolve("nope")).toThrow('Unknown Sklera instance "nope"');
  });
});

describe("ClientRegistry dynamic instances", () => {
  // Minimal stand-in for the DynamicInstanceStore, exercising the resolve()/
  // names() integration without touching disk or crypto.
  function fakeStore(map: Record<string, InstanceConfig>) {
    return {
      names: () => Object.keys(map),
      config: (name: string): InstanceConfig | undefined => map[name],
    };
  }

  it("resolves a dynamic instance and includes it in names() (static wins)", () => {
    const registry = buildRegistryFromInstances(
      { instances: { my: { baseUrl: "https://my.sklera.tv", apiToken: "STATIC" } } },
      "SKLERA_INSTANCES"
    );
    registry.attachDynamicStore(
      fakeStore({
        backup: { baseUrl: "https://sklera.example.net", apiToken: "DYNAMIC" },
        my: { baseUrl: "https://shadow.example", apiToken: "SHOULD_NOT_WIN" },
      }) as never
    );

    // Dynamic instance is resolvable and cached (same client on repeat).
    const backup = registry.resolve("backup");
    expect(backup).toBe(registry.resolve("backup"));
    // Static "my" wins over a dynamic entry of the same name.
    expect(registry.resolve("my").baseUrlValue).toBe("https://my.sklera.tv");
    // names() is the deduped union.
    expect(registry.names().sort()).toEqual(["backup", "my"]);
    expect(registry.staticInstanceNames()).toEqual(["my"]);
  });

  it("still throws for names absent from both static and dynamic sources", () => {
    const registry = buildRegistryFromInstances(
      { instances: { my: { baseUrl: "https://my.sklera.tv", apiToken: "T" } } },
      "SKLERA_INSTANCES"
    );
    registry.attachDynamicStore(fakeStore({}) as never);
    expect(() => registry.resolve("ghost")).toThrow('Unknown Sklera instance "ghost"');
  });
});
