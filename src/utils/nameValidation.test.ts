import { describe, expect, it } from "vitest";
import { isValidIdentifierName } from "./nameValidation.js";

describe("isValidIdentifierName", () => {
  it("accepts a simple name", () => {
    expect(isValidIdentifierName("MyAwesomeApi")).toBe(true);
  });

  it("accepts digits and underscores after the first character", () => {
    expect(isValidIdentifierName("Service_1")).toBe(true);
  });

  it("rejects a name starting with a digit", () => {
    expect(isValidIdentifierName("1Service")).toBe(false);
  });

  it("rejects a name starting with an underscore", () => {
    expect(isValidIdentifierName("_Service")).toBe(false);
  });

  it("rejects embedded spaces - the original bug this exists to catch", () => {
    expect(isValidIdentifierName("My Api ")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidIdentifierName("")).toBe(false);
  });

  it("rejects hyphens", () => {
    expect(isValidIdentifierName("my-api")).toBe(false);
  });

  it("rejects dots", () => {
    expect(isValidIdentifierName("my.api")).toBe(false);
  });
});
