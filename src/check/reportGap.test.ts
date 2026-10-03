import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCheck } from "./runner.js";
import { scanRepo } from "./repo.js";
import { buildGapReport, buildMailto, isUnrecognizedStack, writeGapReportFile } from "./reportGap.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "buildquick-gap-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function write(relPath: string, contents: string): void {
  const full = path.join(tmpDir, relPath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, contents, "utf-8");
}

describe("isUnrecognizedStack", () => {
  it("is false for a known stack even when everything passes", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", "express-rate-limit": "^7", opossum: "^8" } }));
    write("src/app.js", 'app.get("/health", (r, s) => s.send("ok"));');
    const repo = scanRepo(tmpDir);
    expect(isUnrecognizedStack(repo, runCheck(repo))).toBe(false);
  });

  it("is true when real code exists but no stack-specific rule ever engaged", () => {
    // No manifest, no recognized framework/db signal at all - only the two
    // universal rules and the two structural ones can possibly apply.
    write("src/main.rb", 'puts "hi"\n');
    const repo = scanRepo(tmpDir);
    expect(isUnrecognizedStack(repo, runCheck(repo))).toBe(true);
  });
});

describe("buildGapReport", () => {
  it("reports a specific finding by number, metadata only by default (no evidence)", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4" } }));
    write("src/app.js", 'app.get("/x", (r, s) => s.send("ok"));');
    const repo = scanRepo(tmpDir);
    const report = runCheck(repo);
    const gap = buildGapReport(repo, report, 1, "seems wrong", false);
    expect("error" in gap).toBe(false);
    if (!("error" in gap)) {
      expect(gap.kind).toBe("finding");
      expect(gap.finding?.evidence).toBeUndefined();
      expect(gap.note).toBe("seems wrong");
    }
  });

  it("includes evidence only when explicitly opted in", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", pg: "^8", "express-rate-limit": "^7", opossum: "^8" } }));
    write("src/app.js", 'app.get("/health", (r, s) => s.send("ok"));\nconst all = await repo.findAll();');
    const repo = scanRepo(tmpDir);
    const report = runCheck(repo);
    const gap = buildGapReport(repo, report, 1, undefined, true);
    expect(!("error" in gap) && gap.finding?.evidence).toBeTruthy();
  });

  it("errors clearly on an out-of-range finding number instead of crashing", () => {
    write("package.json", "{}");
    write("src/x.js", "1;");
    const repo = scanRepo(tmpDir);
    const gap = buildGapReport(repo, runCheck(repo), 99, undefined, false);
    expect("error" in gap && gap.error).toMatch(/No finding #99/);
  });

  it("reports the unrecognized-stack case when no finding number is given and the stack genuinely isn't recognized", () => {
    write("src/main.rb", "puts 1\n");
    const repo = scanRepo(tmpDir);
    const gap = buildGapReport(repo, runCheck(repo), undefined, undefined, false);
    expect(!("error" in gap) && gap.kind).toBe("unrecognized-stack");
  });

  it("errors clearly when asked to report a gap that doesn't exist", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", "express-rate-limit": "^7", opossum: "^8" } }));
    write("src/app.js", 'app.get("/health", (r, s) => s.send("ok"));');
    const repo = scanRepo(tmpDir);
    const gap = buildGapReport(repo, runCheck(repo), undefined, undefined, false);
    expect("error" in gap).toBe(true);
  });
});

describe("writeGapReportFile", () => {
  it("writes a local record with no evidence field when metadata-only", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4" } }));
    write("src/app.js", 'app.get("/x", (r, s) => s.send("ok"));');
    const repo = scanRepo(tmpDir);
    const gap = buildGapReport(repo, runCheck(repo), 1, "flagged by mistake", false);
    if ("error" in gap) throw new Error("unexpected error building gap report");

    const file = writeGapReportFile(gap, path.join(tmpDir, "gap-reports"));
    expect(existsSync(file)).toBe(true);
    const content = readFileSync(file, "utf-8");
    expect(content).toContain("flagged by mistake");
    expect(content).not.toContain("evidence");
  });
});

describe("buildMailto", () => {
  it("produces a mailto: URL with the report content URL-encoded, addressed to the maintainer", () => {
    const url = buildMailto({ kind: "unrecognized-stack", timestamp: "2026-01-01T00:00:00.000Z" });
    expect(url).toMatch(/^mailto:akinboyewaiyanuoluwa15@gmail\.com\?/);
    expect(url).toContain("subject=");
    expect(url).toContain("body=");
  });
});
