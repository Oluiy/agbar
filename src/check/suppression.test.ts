import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderCheckReport } from "./reportRender.js";
import { scanRepo } from "./repo.js";
import { runCheck } from "./runner.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "agbar-suppress-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function write(rel: string, content: string) {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), content);
}
const check = () => runCheck(scanRepo(dir));

describe("inline suppression", () => {
  beforeEach(() => write("package.json", JSON.stringify({ dependencies: { chalk: "^5" } })));

  it("next-line hides that finding, and the report counts it", () => {
    write("src/sync.js", '// agbar-ignore-next-line http-without-timeout\nawait fetch("https://a.example.com");\n');
    const report = check();
    expect(report.findings.map((f) => f.ruleId)).not.toContain("http-without-timeout");
    expect(report.suppressed).toEqual([expect.objectContaining({ ruleId: "http-without-timeout" })]);
    expect(renderCheckReport(report, dir, false)).toMatch(/1 finding\(s\) hidden by agbar-ignore/);
  });

  it("suppressing one occurrence doesn't hide a second, unsuppressed one", () => {
    write("src/sync.js", '// agbar-ignore-next-line http-without-timeout\nawait fetch("https://a.example.com");\nawait fetch("https://b.example.com");\n');
    const finding = check().findings.find((f) => f.ruleId === "http-without-timeout");
    expect(finding?.evidence).toContain("src/sync.js:3");
  });

  it("file scope hides every occurrence in that file only", () => {
    write("src/a.js", '/* agbar-ignore-file http-without-timeout */\nawait fetch("https://a.example.com");\nawait fetch("https://b.example.com");\n');
    expect(check().findings.map((f) => f.ruleId)).not.toContain("http-without-timeout");
    write("src/b.js", 'await fetch("https://c.example.com");\n');
    expect(check().findings.find((f) => f.ruleId === "http-without-timeout")?.evidence).toContain("src/b.js");
  });

  it("only silences the rules it names", () => {
    write("src/sync.js", '// agbar-ignore-next-line no-circuit-breaker\nawait fetch("https://a.example.com");\n');
    expect(check().findings.map((f) => f.ruleId)).toContain("http-without-timeout");
  });

  it("an unknown rule id is reported, since it silences nothing", () => {
    write("src/sync.js", "# agbar-ignore-file http-timeout\nx = 1\n");
    const report = check();
    expect(report.unknownSuppressions).toEqual(["'http-timeout' at src/sync.js:1"]);
    expect(renderCheckReport(report, dir, false)).toMatch(/unknown rule 'http-timeout'/);
  });

  it("a comment mentioning a timeout is not a timeout", () => {
    write("src/sync.js", '// TODO: add a timeout here\nawait fetch("https://a.example.com");\n');
    expect(check().findings.map((f) => f.ruleId)).toContain("http-without-timeout");
  });

  it("only real comments on their own line count - not strings, docs, or test fixtures", () => {
    write("src/doc.js", '/**\n *   // agbar-ignore-next-line http-without-timeout\n */\nawait fetch("https://a.example.com");\n');
    write("src/fixture.test.js", 'const s = "# agbar-ignore-file made-up-rule";\n');
    const report = check();
    expect(report.findings.map((f) => f.ruleId)).toContain("http-without-timeout");
    expect(report.unknownSuppressions).toEqual([]);
  });

  it("a directive without a rule id does nothing - there is no blanket ignore", () => {
    write("src/sync.js", '// agbar-ignore-next-line\nawait fetch("https://a.example.com");\n');
    expect(check().findings.map((f) => f.ruleId)).toContain("http-without-timeout");
  });
});
