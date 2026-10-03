import { describe, expect, it } from "vitest";
import { blankLiterals } from "./literals.js";

/** Blanks must never shift a line number or column - evidence points at raw lines. */
function expectSameShape(src: string, out: string) {
  expect(out.length).toBe(src.length);
  expect(out.split("\n").length).toBe(src.split("\n").length);
}

describe("blankLiterals", () => {
  it("blanks JS strings, templates and comments, keeping code", () => {
    const src = 'const t = ["axios.get"]; // fetch(x)\nconst s = `fetch(${u})`; /* http.Get( */ call();';
    const out = blankLiterals(src, ".ts");
    expectSameShape(src, out);
    expect(out).not.toMatch(/axios|fetch|http\.Get/);
    expect(out).toContain("const t = [");
    expect(out).toContain("call();");
  });

  it("handles Rust raw strings and leaves lifetimes alone", () => {
    const src = 'fn f<\'a>(x: &\'a str) { let s = r#"WebApplication.CreateBuilder("x")"#; g(); }';
    const out = blankLiterals(src, ".rs");
    expectSameShape(src, out);
    expect(out).not.toContain("CreateBuilder");
    expect(out).toContain("fn f<'a>(x: &'a str)");
    expect(out).toContain("g();");
  });

  it("handles Go raw backtick strings across lines", () => {
    const src = "q := `SELECT *\nFROM t`\nhttp.Get(url)";
    const out = blankLiterals(src, ".go");
    expectSameShape(src, out);
    expect(out).not.toContain("SELECT");
    expect(out.split("\n")[2]).toBe("http.Get(url)");
  });

  it("handles Python triple quotes and # comments", () => {
    const src = 'doc = """requests.get(x)\nmore"""\n# requests.post(y)\nrequests.get(z)';
    const out = blankLiterals(src, ".py");
    expectSameShape(src, out);
    expect(out.split("\n")[3]).toBe("requests.get(z)");
    expect(out.slice(0, out.lastIndexOf("\n"))).not.toMatch(/requests/);
  });

  it("an unterminated quote only blanks to the end of its line", () => {
    const src = "const re = /[\"']/;\nfetch(url);";
    const out = blankLiterals(src, ".js");
    expect(out.split("\n")[1]).toBe("fetch(url);");
  });

  it("handles C# raw string templates and verbatim strings across lines", () => {
    const src = 'var t = $$"""\n    var builder = WebApplication.CreateBuilder(args);\n    """;\nvar p = @"C:\\x ""quoted""\nstill string";\nRun();';
    const out = blankLiterals(src, ".cs");
    expectSameShape(src, out);
    expect(out).not.toContain("CreateBuilder");
    expect(out).not.toContain("still string");
    expect(out.split("\n").pop()).toBe("Run();");
  });

  it("blanks JS regex literals, so a quote or backtick inside one can't swallow the code after it", () => {
    const src = "const re = /[`\"']/g;\nconst x = a / b / c;\nfetch(url);";
    const out = blankLiterals(src, ".js");
    expectSameShape(src, out);
    expect(out.split("\n")[0]).not.toContain("`");
    expect(out.split("\n")[1]).toBe("const x = a / b / c;"); // division is not a regex
    expect(out.split("\n")[2]).toBe("fetch(url);");
  });

  it("leaves unknown file types untouched", () => {
    expect(blankLiterals('key: "value" # x', ".yml")).toBe('key: "value" # x');
  });
});
