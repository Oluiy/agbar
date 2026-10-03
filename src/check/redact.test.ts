import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact.js";

describe("redactSecrets", () => {
  it("hides URL passwords but keeps the host", () => {
    const out = redactSecrets('DB = "postgres://admin:hunter2pw@db.example.com:5432/app"');
    expect(out).not.toContain("hunter2pw");
    expect(out).toContain("db.example.com");
  });

  it("hides ADO.NET, JDBC and assignment-style passwords", () => {
    for (const line of ["Server=x;Password=hunter2pw;Db=y", "jdbc:mysql://h/db?user=a&password=hunter2pw", 'password = "hunter2pw"']) {
      expect(redactSecrets(line)).not.toContain("hunter2pw");
    }
  });

  it("hides AWS key ids", () => {
    expect(redactSecrets('const k = "AKIAZQ3DRSTUVWXY1234";')).not.toContain("ZQ3DRSTUVWXY1234");
  });

  it("leaves ordinary evidence untouched", () => {
    const line = "src/app.ts:12  const res = await fetch(url);";
    expect(redactSecrets(line)).toBe(line);
  });
});
