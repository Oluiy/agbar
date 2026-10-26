import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { printConceptDetail, printConceptsList } from "../conceptsCommand.js";
import { printLearnLanguages, printUnitDetail, printUnitList } from "../learn/learnCommand.js";
import { printTrackDetail, printTracksList } from "../learn/tracksCommand.js";
import { nextStep, progress, shortPath } from "./palette.js";

/** What each screen actually prints, colour stripped - so these assert structure, not escape codes. */
let home: string;
let realHome: string | undefined;
let out: string[];

beforeEach(() => {
  realHome = process.env.HOME;
  home = mkdtempSync(path.join(tmpdir(), "buildquick-ui-"));
  process.env.HOME = home; // progress files live under the home folder - keep the real one out of it
  out = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void out.push(args.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void out.push(args.join(" ")));
});
afterEach(() => {
  vi.restoreAllMocks();
  process.env.HOME = realHome;
  rmSync(home, { recursive: true, force: true });
});

const text = () => out.join("\n").replace(/\x1b\[[0-9;]*m/g, "");

describe("palette helpers", () => {
  it("shortens the home folder to ~, so a long temp path doesn't bury the file name", () => {
    expect(shortPath(`${process.env.HOME}/.buildquick/learn/x/answer.txt`)).toBe("~/.buildquick/learn/x/answer.txt");
    expect(shortPath("/etc/hosts")).toBe("/etc/hosts");
  });

  it("a next step and a progress reading carry their meaning as plain text", () => {
    expect(nextStep("open it:", "buildquick learn traps 1").replace(/\x1b\[[0-9;]*m/g, "")).toBe("Next: open it: buildquick learn traps 1");
    expect(progress(2, 5).replace(/\x1b\[[0-9;]*m/g, "")).toBe("2 of 5");
  });
});

describe("learn screens", () => {
  it("the course list shows each course's size and YOUR progress, and ends on a next step", () => {
    printLearnLanguages();
    expect(text()).toMatch(/Courses\s+7 courses/);
    expect(text()).toMatch(/traps\s+4 lessons · 0 of 4 done/);
    expect(text()).toMatch(/Next: new here\? a guided path: buildquick tracks first-steps/);
  });

  it("a lesson list shows status words (not just colour), minutes, and the next lesson to open", () => {
    printUnitList("traps");
    expect(text()).toMatch(/0 of 4 lessons done/);
    expect(text()).toMatch(/○ not started\s+1\. Text Traps/);
    expect(text()).toMatch(/~20 min/);
    expect(text()).toMatch(/Next: open lesson 1: buildquick learn traps 1/);
    expect(text()).not.toMatch(/\[core\]/); // every lesson is core here - the tag would be noise
  });

  it("a lesson page is three headed sections with numbered challenges and a short path", () => {
    printUnitDetail("traps", "2");
    const t = text();
    expect(t).toMatch(/traps · lesson 2 of 4 · about \d+ min · 2 challenges/);
    for (const section of ["What to know", "Example", "Your turn"]) expect(t).toContain(section);
    expect(t).toMatch(/Challenge 1 of 2 · predict-numbers/);
    expect(t).toMatch(/Edit\s+~\/\.buildquick\/learn\/traps\/02-number-traps\/predict-numbers\/answer\.txt/);
    expect(t).toMatch(/Then\s+buildquick submit predict-numbers/);
  });
});

describe("track screens", () => {
  it("the list shows each track's size and progress, and marks where to start", () => {
    printTracksList();
    expect(text()).toMatch(/First steps.*← start here/);
    expect(text()).toMatch(/0 of \d+ lessons done/);
    expect(text()).toMatch(/buildquick tracks first-steps/);
  });

  it("a track shows a progress line, aligned columns, 'you are here', and one next command", () => {
    printTrackDetail("first-steps");
    const t = text();
    expect(t).toMatch(/Progress\s+░+\s+0 of \d+ lessons done/);
    expect(t).toMatch(/1\.\s+○ not started\s+YAML.*← you are here/);
    expect(t).toMatch(/·\s+read\s+Secrets management/);
    expect(t).toMatch(/Next: buildquick learn yaml 1/);
    // A step's command hangs directly under its title: the same column for lessons and reads.
    const lines = t.split("\n");
    const titleCol = lines.find((l) => l.includes("YAML:"))!.indexOf("YAML:");
    const readCol = lines.find((l) => l.includes("Secrets management"))!.indexOf("Secrets management");
    expect(readCol).toBe(titleCol);
  });
});

describe("concept screens", () => {
  it("the list lines the ids up in a column - the thing you type - under each topic heading", () => {
    printConceptsList();
    const t = text();
    expect(t).toMatch(/Concepts\s+83 across \d+ topics/);
    expect(t).toMatch(/Design \(6\)/);
    const lines = t.split("\n").filter((l) => /^ {2}\S.*\s{2}[a-z-]+$/.test(l));
    expect(lines.length).toBeGreaterThan(60);
    expect(t).toMatch(/Next: open one: buildquick concepts <id>/);
  });

  it("a concept has a heading per section and ends on one next step", () => {
    printConceptDetail("timeouts");
    const t = text();
    for (const section of ["Where this bites you", "The fix", "In code"]) expect(t).toContain(section);
    expect(t).toMatch(/Next: browse more: buildquick concepts/);

    out.length = 0;
    printConceptDetail("regex-anchoring");
    expect(text()).toMatch(/Next: practise it: buildquick learn regex 01-anchors-and-escapes/);
  });
});
