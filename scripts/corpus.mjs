// Precision corpus: runs `check` over every repo in corpus/repos.txt and compares the
// findings with corpus/baseline.txt, so a rule change shows up as a diff instead of a
// feeling. Lines are "repo severity rule file:line" - never evidence text, so no
// secret can end up in the baseline.
//
//   npm run corpus            diff against the baseline (exit 1 if anything changed)
//   npm run corpus -- --update   accept the current output as the new baseline
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const reposFile = path.join(root, "corpus", "repos.txt");
const baselineFile = path.join(root, "corpus", "baseline.txt");

const repos = readFileSync(reposFile, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => (l.startsWith("~") ? path.join(homedir(), l.slice(1)) : l));

// A repo that has moved or been cleared from /tmp must be loud: silently skipping it
// shrinks the corpus, and a smaller corpus "passes" while covering less.
const missing = repos.filter((r) => !existsSync(r));
if (missing.length) {
  console.log(`missing ${missing.length} repo(s) - re-clone or edit corpus/repos.txt:`);
  for (const m of missing) console.log(`  ${m}`);
}
const present = repos.filter((r) => existsSync(r));

const current = [];
for (const repo of present) {
  let json;
  try {
    json = JSON.parse(execFileSync("node", [path.join(root, "dist", "cli.js"), "check", repo, "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    current.push(`${path.basename(repo)} ERROR check failed`);
    continue;
  }
  for (const f of json.findings) current.push(`${path.basename(repo)} ${f.severity[0]} ${f.ruleId} ${(f.evidence ?? "").split("  ")[0]}`.trimEnd());
}
current.sort();

if (process.argv.includes("--update") || !existsSync(baselineFile)) {
  writeFileSync(baselineFile, current.join("\n") + "\n");
  console.log(`baseline written: ${current.length} findings across ${present.length} repos`);
  process.exit(0);
}

const baseline = readFileSync(baselineFile, "utf8").split("\n").filter(Boolean);
const added = current.filter((l) => !baseline.includes(l));
const removed = baseline.filter((l) => !current.includes(l));
for (const l of added) console.log(`+ ${l}`);
for (const l of removed) console.log(`- ${l}`);
console.log(added.length + removed.length === 0 ? `no change: ${current.length} findings across ${present.length} repos` : `${added.length} new, ${removed.length} gone - give every "+" a verdict from the source`);
process.exit(added.length + removed.length === 0 ? 0 : 1);
