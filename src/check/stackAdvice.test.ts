import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanRepo } from "./repo.js";
import { RULES } from "./rules.js";
import { runCheck } from "./runner.js";
import { dominantLanguage, STACK_ADVICE } from "./stackAdvice.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "agbar-advice-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function write(rel: string, content: string) {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), content);
}
const adviceFor = (ruleId: string) => runCheck(scanRepo(dir)).findings.find((f) => f.ruleId === ruleId)?.nextStep ?? "";

describe("advice names the project's own tools", () => {
  it("a Rust service is told about Rust crates - not express-rate-limit or resilience4j", () => {
    write("Cargo.toml", '[dependencies]\naxum = "0.8"\n');
    write("src/main.rs", "let app = Router::new();\n");
    const advice = adviceFor("no-rate-limiting");
    expect(advice).toMatch(/tower-governor/);
    expect(advice).not.toMatch(/express|nestjs|resilience4j/i);
  });

  it("a Go project gets Go migration tools; a Rust one gets sqlx", () => {
    write("go.mod", "module x\nrequire modernc.org/sqlite v1.0.0\n");
    write("store.go", "const schema = `CREATE TABLE IF NOT EXISTS t (id int)`\n");
    expect(adviceFor("no-schema-migrations")).toMatch(/golang-migrate/);

    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    write("Cargo.toml", '[dependencies]\nrusqlite = "0.31"\n');
    write("src/store.rs", 'conn.execute("CREATE TABLE IF NOT EXISTS t (id int)", [])?;\n');
    expect(adviceFor("no-schema-migrations")).toMatch(/sqlx migrate/);
  });

  it("a Node project keeps the original Node-flavoured advice", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4" } }));
    write("src/app.js", 'app.get("/items", (r, s) => s.json([]));\n');
    expect(adviceFor("no-rate-limiting")).toMatch(/express-rate-limit/);
  });

  it("the language of the file a finding points at wins over the project's dominant one", () => {
    write("go.mod", "module x\nrequire github.com/gofiber/fiber/v2 v2.52.0\n");
    for (const n of ["a", "b", "c"]) write(`${n}.go`, "app := fiber.New()\n");
    write("scripts/sync.py", 'import requests\nr = requests.get("https://api.example.com")\n');
    write("requirements.txt", "requests\n");
    expect(adviceFor("http-without-timeout")).toMatch(/requests\.get\(url, timeout=/); // Python, though Go dominates
  });

  it("a language with no entry falls back to the rule's generic advice instead of nothing", () => {
    write("Gemfile", "gem 'rails'\n");
    write("app.rb", "Rails.application.routes.draw do\nend\n");
    expect(adviceFor("no-rate-limiting")).toMatch(/Rack::Attack/);
  });

  it("rules whose advice isn't tool-specific keep their text exactly", () => {
    write("a.go", "package main\n".repeat(600));
    const god = runCheck(scanRepo(dir)).findings.find((f) => f.ruleId === "god-file");
    expect(god?.nextStep).toBe(RULES.find((r) => r.id === "god-file")!.nextStep);
  });
});

describe("dominantLanguage", () => {
  it("ignores client-side files: a Rust service with a JavaScript admin page is Rust", () => {
    write("Cargo.toml", '[dependencies]\naxum = "0.8"\n');
    write("src/main.rs", "fn main() {}\n");
    write("src/lib.rs", "fn x() {}\n");
    for (const n of ["a", "b", "c", "d"]) write(`web/js/${n}.js`, "export {};\n");
    expect(dominantLanguage(scanRepo(dir))).toBe("rust");
  });

  it("is undefined, not a guess, when there's no code", () => {
    write("README.md", "hello\n");
    expect(dominantLanguage(scanRepo(dir))).toBeUndefined();
  });
});

describe("the advice table stays complete and honest", () => {
  const LANGUAGES = ["node", "python", "go", "rust", "java", "dotnet", "ruby", "php"] as const;

  it("every entry is for a real rule, and covers every language - so none can silently fall back", () => {
    const ruleIds = new Set(RULES.map((r) => r.id));
    for (const [ruleId, perLanguage] of Object.entries(STACK_ADVICE)) {
      expect(ruleIds.has(ruleId), `'${ruleId}' isn't a rule`).toBe(true);
      for (const language of LANGUAGES) expect(perLanguage[language], `${ruleId} has no ${language} advice`).toBeTruthy();
    }
  });

  it("a language's advice never names another ecosystem's tools", () => {
    // Tools that belong to exactly one ecosystem, and so can't appear in any other's advice.
    const owners: Record<string, RegExp> = {
      node: /express-rate-limit|@nestjs|opossum|node-pg-migrate|\bknex\b/i,
      python: /slowapi|Flask-Limiter|pybreaker|Alembic|django-ratelimit/i,
      go: /golang-migrate|gobreaker|tollbooth|x\/time\/rate|SetMaxOpenConns/i,
      rust: /tower-governor|reqwest|sqlx|failsafe|deadpool/i,
      java: /resilience4j|Bucket4j|HikariCP|Flyway|Liquibase/i,
      dotnet: /Polly|AddRateLimiter|dotnet ef|Npgsql/i,
      ruby: /Rack::Attack|circuitbox|Semian|database\.yml/i,
      php: /Guzzle|ganesha|Laravel|PDO::ATTR_PERSISTENT/i,
    };
    for (const [ruleId, perLanguage] of Object.entries(STACK_ADVICE)) {
      for (const language of LANGUAGES) {
        for (const other of LANGUAGES) {
          if (other === language) continue;
          expect(perLanguage[language], `${ruleId}/${language} mentions a ${other} tool`).not.toMatch(owners[other]);
        }
      }
    }
  });
});
