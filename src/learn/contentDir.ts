import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where lesson/track content is read from, in priority order:
 *
 *   1. AGBAR_CONTENT env var
 *   2. "contentDir" in a .agbarrc JSON file in the current directory
 *   3. the content/ directory bundled with this package
 *
 * A custom directory doesn't have to be complete - resolution falls through to
 * the bundled content for anything it doesn't provide. That's what lets a team
 * ship only their own standards (one track, a few units) without having to
 * re-vendor everything agbar already ships.
 */

function rcContentDir(): string | undefined {
  const rcPath = path.join(process.cwd(), ".agbarrc");
  if (!existsSync(rcPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(rcPath, "utf-8")) as { contentDir?: unknown };
    return typeof parsed.contentDir === "string" ? parsed.contentDir : undefined;
  } catch {
    throw new Error(`${rcPath} isn't valid JSON.`);
  }
}

/** Custom content roots, highest priority first. Empty when neither is configured. */
export function customContentRoots(): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.AGBAR_CONTENT;
  if (fromEnv) roots.push(path.resolve(fromEnv));
  const fromRc = rcContentDir();
  if (fromRc) roots.push(path.resolve(process.cwd(), fromRc));
  return roots;
}

/**
 * The content/ directory shipped inside this package. Walks upward from this
 * file's own runtime location - never process.cwd() - so it resolves the same
 * whether running from src/ via tsx (two levels below the repo root) or from
 * tsup's bundled dist/cli.js (one level below the installed package root).
 */
export function bundledContentRoot(): string | undefined {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, "content");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/** Every content root to search, custom first, bundled last. */
export function contentRoots(): string[] {
  const roots = customContentRoots();
  const bundled = bundledContentRoot();
  if (bundled) roots.push(bundled);
  return roots;
}

/** First content root containing `relativePath`, or undefined if none do. */
export function resolveContentPath(relativePath: string): string | undefined {
  for (const root of contentRoots()) {
    const candidate = path.join(root, relativePath);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}
