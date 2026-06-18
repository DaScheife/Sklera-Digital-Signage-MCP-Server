import { describe, it, expect, afterEach } from "vitest";
import {
  formatToolError,
  successText,
  resolveTimeoutMs,
  DEFAULT_HTTP_TIMEOUT_MS,
  SkleraClient,
} from "./client.js";

describe("resolveTimeoutMs", () => {
  const original = process.env.SKLERA_HTTP_TIMEOUT_MS;

  afterEach(() => {
    if (original === undefined) delete process.env.SKLERA_HTTP_TIMEOUT_MS;
    else process.env.SKLERA_HTTP_TIMEOUT_MS = original;
  });

  it("defaults to 60000ms when the env var is unset", () => {
    delete process.env.SKLERA_HTTP_TIMEOUT_MS;
    expect(resolveTimeoutMs()).toBe(DEFAULT_HTTP_TIMEOUT_MS);
    expect(DEFAULT_HTTP_TIMEOUT_MS).toBe(60000);
  });

  it("uses a valid numeric override from the env var", () => {
    process.env.SKLERA_HTTP_TIMEOUT_MS = "90000";
    expect(resolveTimeoutMs()).toBe(90000);
  });

  it("falls back to the default for non-numeric or non-positive values", () => {
    process.env.SKLERA_HTTP_TIMEOUT_MS = "abc";
    expect(resolveTimeoutMs()).toBe(DEFAULT_HTTP_TIMEOUT_MS);
    process.env.SKLERA_HTTP_TIMEOUT_MS = "0";
    expect(resolveTimeoutMs()).toBe(DEFAULT_HTTP_TIMEOUT_MS);
    process.env.SKLERA_HTTP_TIMEOUT_MS = "-5";
    expect(resolveTimeoutMs()).toBe(DEFAULT_HTTP_TIMEOUT_MS);
  });
});

describe("successText", () => {
  it("formats an object as pretty-printed JSON", () => {
    // Arrange
    const data = { id: 1, name: "Screen A" };

    // Act
    const result = successText(data);

    // Assert
    expect(result).toBe('{\n  "id": 1,\n  "name": "Screen A"\n}');
  });

  it("handles primitive values", () => {
    expect(successText("hello")).toBe('"hello"');
    expect(successText(42)).toBe("42");
  });
});

describe("SkleraClient provisioning write guard", () => {
  const client = new SkleraClient({ baseUrl: "https://my.sklera.tv", apiToken: "TESTTOKEN" });

  it("refuses POST/PUT/DELETE against any provisioning path", async () => {
    await expect(client.post("/provisioning/createAccount", {})).rejects.toThrow(/read-only/);
    await expect(client.put("/provisioning/edit/c1", {})).rejects.toThrow(/read-only/);
    await expect(client.delete("/provisioning/deleteAccount/c1")).rejects.toThrow(/read-only/);
  });

  it("exposes a masked token and the base url", () => {
    expect(client.baseUrlValue).toBe("https://my.sklera.tv");
    expect(client.maskedToken()).toBe("…OKEN");
  });
});

describe("formatToolError", () => {
  it("uses the message of a real Error", () => {
    // Arrange
    const err = new Error("Sklera API error 404: not found");

    // Act
    const result = formatToolError(err);

    // Assert
    expect(result).toBe("Error: Sklera API error 404: not found");
  });

  it("stringifies non-Error values", () => {
    expect(formatToolError("boom")).toBe("Error: boom");
    expect(formatToolError(undefined)).toBe("Error: undefined");
  });
});
