import os from "node:os";
import path from "node:path";
import { writeFile } from "../utils/fsWrite.js";
import { readJsonFile } from "../utils/jsonFile.js";

/**
 * The lesson you last opened, so `agbar submit` can grade it without you
 * retyping the course, lesson and challenge. Path injectable for tests.
 */
export interface LastOpened {
  language: string;
  unitId: string;
}

export function defaultLastOpenedPath(): string {
  return path.join(os.homedir(), ".agbar", "learn", "last-opened.json");
}

export function saveLastOpened(value: LastOpened, filePath = defaultLastOpenedPath()): void {
  writeFile(filePath, JSON.stringify(value));
}

export function loadLastOpened(filePath = defaultLastOpenedPath()): LastOpened | undefined {
  return readJsonFile<LastOpened | undefined>(filePath, undefined, "last opened lesson");
}
