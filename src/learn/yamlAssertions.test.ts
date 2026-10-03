import { describe, expect, it } from "vitest";
import { failureOf, lookup, parseAssertions } from "./yamlAssertions.js";

describe("lookup", () => {
  it("treats a key with an empty value as present - `workflow_dispatch:` is real", () => {
    expect(lookup({ on: { workflow_dispatch: null } }, "on.workflow_dispatch")).toEqual({ found: true, value: null });
    expect(lookup({ on: {} }, "on.workflow_dispatch").found).toBe(false);
  });

  it("walks list indexes and hyphenated keys", () => {
    expect(lookup({ jobs: { t: { "runs-on": "x", steps: [{ uses: "a" }] } } }, "jobs.t.steps[0].uses").value).toBe("a");
    expect(lookup({ steps: [] }, "steps[0]").found).toBe(false);
  });
});

describe("failureOf", () => {
  it("ignores map key order when comparing", () => {
    expect(failureOf({ m: { b: 2, a: 1 } }, { path: "m", message: "", equals: { a: 1, b: 2 } })).toBeUndefined();
  });

  it("names the parsed type when it differs - the 3.10 trap", () => {
    expect(failureOf({ v: 3.1 }, { path: "v", message: "", type: "string" })).toMatch(/parsed as a number \(3\.1\)/);
  });

  it("hasItem is order-independent and needs every sub-path on the same item", () => {
    const steps = { s: [{ run: "npm test" }, { uses: "actions/checkout@v4" }] };
    expect(failureOf(steps, { path: "s", message: "", hasItem: { uses: "^actions/checkout@" } })).toBeUndefined();
    expect(failureOf(steps, { path: "s", message: "", hasItem: { uses: "checkout", run: "npm" } })).toMatch(/no item/);
  });

  it("exists: false fails when the key is present", () => {
    expect(failureOf({ a: 1 }, { path: "a", message: "", exists: false })).toMatch(/should not be there/);
  });
});

describe("parseAssertions fails loudly on lesson mistakes", () => {
  it("rejects a typo'd check name, which would otherwise always pass", () => {
    expect(() => parseAssertions([{ path: "a", message: "m", equal: 1 }], "u")).toThrow(/unknown field 'equal'/);
  });

  it("rejects an assertion with no check at all", () => {
    expect(() => parseAssertions([{ path: "a", message: "m" }], "u")).toThrow(/always pass/);
  });

  it("rejects bad regexes and non-ISO times", () => {
    expect(() => parseAssertions([{ path: "a", message: "m", matches: "(" }], "u")).toThrow(/invalid regex/);
    // A non-string used to be coerced to "[object Object]" - a valid regex - and pass.
    expect(() => parseAssertions([{ path: "a", message: "m", matches: { a: 1 } }], "u")).toThrow(/regex must be a string/);
    expect(() => parseAssertions([{ path: "a", message: "m", has_item: { k: 5 } }], "u")).toThrow(/regex must be a string/);
    // A real string regex is still accepted.
    expect(() => parseAssertions([{ path: "a", message: "m", matches: "^\\d+$" }], "u")).not.toThrow();
    expect(() => parseAssertions([{ path: "a", message: "m", cron_fires: ["monday"] }], "u")).toThrow(/ISO 8601/);
  });
});
