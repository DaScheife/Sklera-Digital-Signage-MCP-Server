import { describe, it, expect } from "vitest";
import { formatToolError, successText } from "./client.js";

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
