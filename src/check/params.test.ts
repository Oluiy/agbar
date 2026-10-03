import { describe, expect, it } from "vitest";
import { isOneOffLoader } from "./fileKinds.js";
import { parametersAt, topLevelParams } from "./params.js";

describe("topLevelParams - parameters split only at top-level commas", () => {
  const params = (src: string) => topLevelParams(src, src.indexOf("("));

  it("generic type arguments don't split a parameter", () => {
    expect(params("S(IDictionary<string, decimal> a, ILogger<S> b)")).toEqual(["IDictionary<string, decimal> a", "ILogger<S> b"]);
  });

  it("a function-typed parameter doesn't end the list at its own ')'", () => {
    expect(params("NewCache(m map[string]int, f func(int, int) error, l *log.Logger)")).toHaveLength(3);
  });

  it("arrows are not closing brackets: Rust/Kotlin -> and JS => inside a parameter", () => {
    expect(params("f(cb: (Int) -> String, g: Map<String, Int>, h: () => void)")).toHaveLength(3);
  });

  it("nested calls in default values, and a trailing comma", () => {
    expect(params("f(a = g(1, 2), b = [1, 2], c,)")).toHaveLength(3);
  });

  it("an unbalanced list gives undefined - no guess - rather than a wrong count", () => {
    expect(params("f(a, b")).toBeUndefined();
  });

  it("an empty list is zero parameters", () => {
    expect(params("f()")).toEqual([]);
  });
});

describe("parametersAt - multi-line signatures", () => {
  it("joins lines until the list closes", () => {
    const lines = ["    public OwnerController(", "            OwnerService a,", "            PetService b", "    ) {"];
    expect(parametersAt(lines, 0)).toEqual(["OwnerService a", "PetService b"]);
  });

  it("gives up after the line limit instead of reading the whole file", () => {
    expect(parametersAt(["f(", ...Array(40).fill("a,")], 0, 10)).toBeUndefined();
  });
});

describe("isOneOffLoader - seeders and migrations, not words that merely start alike", () => {
  it("recognises delimited and CamelCase loaders", () => {
    for (const p of [
      "backend/Extensions/DatabaseSeeder.cs",
      "src/seeds/users.ts",
      "db/seed.rb",
      "db/migrate/001.rb",
      "src/seeding/x.ts",
      "src/services/fixtures.js",
      "Data/MigrationRunner.cs",
    ]) {
      expect(isOneOffLoader(p), p).toBe(true);
    }
  });

  it("leaves ordinary code alone", () => {
    for (const p of ["src/Models/Seedling.cs", "Controllers/ProductController.cs", "src/ResearchService.cs", "src/Migratory/Birds.cs"]) {
      expect(isOneOffLoader(p), p).toBe(false);
    }
  });
});
