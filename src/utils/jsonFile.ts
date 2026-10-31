import { existsSync, readFileSync } from "node:fs";

/**
 * Reads a JSON state file agbar itself wrote. Missing = `fallback`.
 * Corrupted (a crash mid-write, a hand edit) = an error that names the file and
 * says how to recover, instead of a raw SyntaxError with a stack trace.
 */
export function readJsonFile<T>(filePath: string, fallback: T, whatItHolds: string): T {
  if (!existsSync(filePath)) return fallback;
  const text = readFileSync(filePath, "utf-8");
  if (text.trim() === "") return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${filePath} is corrupted (not valid JSON), so your ${whatItHolds} can't be read. Fix it by hand, or delete it to start that record over.`);
  }
}
