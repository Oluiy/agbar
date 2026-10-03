import pc from "picocolors";
import { describe, expect, it } from "vitest";
import { codeBlock, emphasize } from "./terminalText.js";

describe("terminal text", () => {
  it("with colour off, text keeps its **markers** and `code` ticks, so the emphasis isn't lost", () => {
    if (pc.isColorSupported) return; // only meaningful where colour is off (as under test)
    expect(emphasize("A **key point** about `code`.")).toBe("A **key point** about `code`.");
  });

  it("indents every line of a code block and never drops a line", () => {
    const code = "// Bad: slow\nquery();\n// Good: fast\nbatch();";
    const out = codeBlock(code).split("\n");
    expect(out).toHaveLength(4);
    expect(out.every((l) => l.startsWith("  "))).toBe(true);
  });
});
