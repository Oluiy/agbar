import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Every file under `dir`, as paths relative to `dir`, sorted - the shape a snapshot diff reads clearly. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  function walk(current: string) {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(path.relative(dir, full));
    }
  }
  walk(dir);
  return out.sort();
}
