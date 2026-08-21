import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Writes `content` to `filePath`, creating any missing parent directories first.
export function writeFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf-8");
}

// Creates `dirPath` (and any missing parents) if it doesn't already exist.
export function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}
