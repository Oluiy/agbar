import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadUnits } from "../loader.js";
import type { Challenge } from "../types.js";
import { yamlChecker } from "./yamlChecker.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "buildquick-yaml-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function grade(challenge: Challenge, source: string) {
  writeFileSync(path.join(dir, "solution.yml"), source);
  return yamlChecker.run(challenge, dir);
}

/** One correct answer per shipped challenge - written differently from the lesson's examples where possible. */
const SOLUTIONS: Record<string, string> = {
  "fix-the-types": `service: billing\npython_version: "3.10"\nzip_code: "01234"\ndebug: false\nregions: [us-east-1, eu-west-1]\n`,
  "multiline-script": `script: |\n  npm ci\n  npm run build\n  npm test\n`,
  "first-ci-workflow": `name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: |
          npm ci
          npm test
`,
  "deploy-after-tests": `on: { push: { branches: [main] }, pull_request: null }
jobs:
  test:
    runs-on: ubuntu-latest
    steps: [{ run: npm test }]
  deploy:
    needs: [test]
    if: \${{ github.ref == 'refs/heads/main' }}
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy.sh
        env:
          DEPLOY_TOKEN: \${{ secrets.DEPLOY_TOKEN }}
`,
  "weekday-standup": `on:\n  schedule:\n    - cron: "30 9 * * MON-FRI"\n`,
  "safe-scheduled-cleanup": `on:
  schedule:
    - cron: "17 0,6,12,18 * * *"
  workflow_dispatch:
concurrency:
  cancel-in-progress: false
  group: cleanup
`,
};

describe("every shipped YAML challenge", () => {
  const challenges = loadUnits("yaml").flatMap((u) => u.challenges);

  it("has a reference solution here, so none can ship ungraded", () => {
    expect(challenges.map((c) => c.id).sort()).toEqual(Object.keys(SOLUTIONS).sort());
  });

  for (const challenge of challenges) {
    it(`${challenge.id}: the starter fails and a correct answer passes`, async () => {
      expect((await grade(challenge, challenge.starterCode)).passed).toBe(false);
      const result = await grade(challenge, SOLUTIONS[challenge.id]);
      expect(result.message).toBe(`All ${challenge.assertions!.length} checks pass.`);
    });
  }
});

describe("yamlChecker explains parse errors instead of crashing", () => {
  const cronChallenge = (): Challenge =>
    loadUnits("yaml")
      .flatMap((u) => u.challenges)
      .find((c) => c.id === "weekday-standup")!;

  it("an unquoted cron starting with * is explained as an alias problem", async () => {
    const result = await grade(cronChallenge(), "on:\n  schedule:\n    - cron: */5 * * * *\n");
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(/line 3.*alias.*Quote it/);
  });

  it("an alias with no anchor is explained, not thrown", async () => {
    const result = await grade(cronChallenge(), "on:\n  schedule:\n    - cron: *everyday\n");
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(/alias.*Quote it/);
  });

  it("tab indentation is named as the problem", async () => {
    const result = await grade(cronChallenge(), "on:\n\tschedule: x\n");
    expect(result.message).toMatch(/tabs/);
  });

  it("a wrong schedule says which time it got wrong", async () => {
    const result = await grade(cronChallenge(), 'on:\n  schedule:\n    - cron: "30 9 * * *"\n');
    expect(result.message).toMatch(/fires at 2026-09-26T09:30:00Z/);
  });
});
