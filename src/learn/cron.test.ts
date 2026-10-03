import { describe, expect, it } from "vitest";
import { cronMatches, nextFireTimes, parseCron } from "./cron.js";

const at = (iso: string) => new Date(iso);
const fires = (expr: string, iso: string) => cronMatches(parseCron(expr), at(iso));

describe("cron", () => {
  it("matches weekdays by number and by name alike", () => {
    for (const expr of ["30 9 * * 1-5", "30 9 * * MON-FRI", "30 9 * * mon,tue,wed,thu,fri"]) {
      expect(fires(expr, "2026-09-21T09:30:00Z")).toBe(true); // Monday
      expect(fires(expr, "2026-09-26T09:30:00Z")).toBe(false); // Saturday
    }
  });

  it("evaluates in UTC, whatever the machine's timezone", () => {
    expect(fires("0 9 * * *", "2026-09-21T09:00:00Z")).toBe(true);
    expect(fires("0 9 * * *", "2026-09-21T09:00:00+01:00")).toBe(false); // 08:00 UTC
  });

  it("*/45 is minutes 0 and 45, not 'every 45 minutes'", () => {
    const times = nextFireTimes("*/45 * * * *", at("2026-09-21T00:00:00Z"), 3).map((t) => t.toISOString().slice(11, 16));
    expect(times).toEqual(["00:45", "01:00", "01:45"]);
  });

  it("a day matches if EITHER day field does when both are restricted", () => {
    expect(fires("0 9 1 * MON", "2026-09-21T09:00:00Z")).toBe(true); // a Monday, not the 1st
    expect(fires("0 9 1 * MON", "2026-10-01T09:00:00Z")).toBe(true); // the 1st, a Thursday
    expect(fires("0 9 1 * MON", "2026-09-22T09:00:00Z")).toBe(false);
  });

  it("supports N/step as 'from N to the end'", () => {
    expect(fires("5/20 * * * *", "2026-09-21T10:45:00Z")).toBe(true);
    expect(fires("5/20 * * * *", "2026-09-21T10:40:00Z")).toBe(false);
  });

  it("rejects invalid expressions with a message naming the field", () => {
    expect(() => parseCron("* * * *")).toThrow(/exactly 5 fields/);
    expect(() => parseCron("60 * * * *")).toThrow(/minute must be 0-59/);
    expect(() => parseCron("* * * * 7")).toThrow(/day-of-week must be 0-6/);
    expect(() => parseCron("*/0 * * * *")).toThrow(/step/);
    expect(() => parseCron("0 9-5 * * *")).toThrow(/backwards/);
  });

  it("explains @daily-style shortcuts, which GitHub Actions doesn't accept", () => {
    expect(() => parseCron("@daily")).toThrow(/Write the five fields instead: '0 0 \* \* \*'/);
  });

  it("returns nothing, rather than looping forever, for a date that never exists", () => {
    expect(nextFireTimes("0 0 30 2 *", at("2026-01-01T00:00:00Z"), 1)).toEqual([]);
  });
});
