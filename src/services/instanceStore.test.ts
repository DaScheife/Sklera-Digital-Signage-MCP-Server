import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DynamicInstanceStore, maskToken } from "./instanceStore.js";

/**
 * The store encrypts tokens at rest and is re-read on mtime changes. Tests use
 * an explicit secret so the AES key is deterministic and no key file is needed.
 */
describe("DynamicInstanceStore", () => {
  let dir: string;
  let storeFile: string;

  beforeEach(() => {
    process.env.SKLERA_INSTANCE_SECRET = "test-secret-do-not-use-in-prod";
    dir = mkdtempSync(join(tmpdir(), "sklera-store-"));
    storeFile = join(dir, "dynamic-instances.json");
  });

  afterEach(() => {
    delete process.env.SKLERA_INSTANCE_SECRET;
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds an instance and returns the decrypted config", () => {
    // Arrange
    const store = new DynamicInstanceStore(storeFile);

    // Act
    store.add({
      name: "radiomax-backup",
      baseUrl: "https://sklera.radiomax.technology",
      apiToken: "SECRET_TOKEN_1234",
      label: "Backup",
      nowIso: "2026-06-18T00:00:00.000Z",
    });

    // Assert
    const cfg = store.config("radiomax-backup");
    expect(cfg).toEqual({
      baseUrl: "https://sklera.radiomax.technology",
      apiToken: "SECRET_TOKEN_1234",
    });
    expect(store.names()).toEqual(["radiomax-backup"]);
    expect(store.has("radiomax-backup")).toBe(true);
  });

  it("never stores or lists the token in clear text", () => {
    const store = new DynamicInstanceStore(storeFile);
    store.add({
      name: "x",
      baseUrl: "https://my.sklera.tv",
      apiToken: "SUPERSECRET9876",
      nowIso: "2026-06-18T00:00:00.000Z",
    });

    const onDisk = readFileSync(storeFile, "utf8");
    expect(onDisk).not.toContain("SUPERSECRET9876");

    const listed = store.list();
    expect(listed[0].tokenMasked).toBe("…9876");
    expect(JSON.stringify(listed)).not.toContain("SUPERSECRET9876");
  });

  it("persists across instances and reloads on mtime change", () => {
    const writer = new DynamicInstanceStore(storeFile);
    writer.add({
      name: "a",
      baseUrl: "https://my.sklera.tv",
      apiToken: "TOKEN_AAAA",
      nowIso: "2026-06-18T00:00:00.000Z",
    });

    // A second store instance (simulating a later request) reads the same file.
    const reader = new DynamicInstanceStore(storeFile);
    expect(reader.config("a")?.apiToken).toBe("TOKEN_AAAA");

    // An out-of-band write is picked up via mtime reload.
    writer.add({
      name: "b",
      baseUrl: "https://my.sklera.tv",
      apiToken: "TOKEN_BBBB",
      nowIso: "2026-06-18T01:00:00.000Z",
    });
    expect(reader.names().sort()).toEqual(["a", "b"]);
  });

  it("removes only the named instance and reports whether it existed", () => {
    const store = new DynamicInstanceStore(storeFile);
    store.add({
      name: "gone",
      baseUrl: "https://my.sklera.tv",
      apiToken: "T1234",
      nowIso: "2026-06-18T00:00:00.000Z",
    });

    expect(store.remove("gone")).toBe(true);
    expect(store.has("gone")).toBe(false);
    expect(store.remove("never-existed")).toBe(false);
  });

  it("preserves createdAt and updates updatedAt on re-add", () => {
    const store = new DynamicInstanceStore(storeFile);
    store.add({
      name: "u",
      baseUrl: "https://my.sklera.tv",
      apiToken: "T1",
      nowIso: "2026-06-18T00:00:00.000Z",
    });
    store.add({
      name: "u",
      baseUrl: "https://my.sklera.tv",
      apiToken: "T2",
      nowIso: "2026-06-19T00:00:00.000Z",
    });
    const info = store.list().find((i) => i.name === "u");
    expect(info?.createdAt).toBe("2026-06-18T00:00:00.000Z");
    expect(info?.updatedAt).toBe("2026-06-19T00:00:00.000Z");
    expect(store.config("u")?.apiToken).toBe("T2");
  });
});

describe("maskToken", () => {
  it("shows only the last 4 characters", () => {
    expect(maskToken("abcdefgh")).toBe("…efgh");
  });
  it("fully masks short tokens", () => {
    expect(maskToken("abc")).toBe("****");
    expect(maskToken("")).toBe("****");
  });
});
