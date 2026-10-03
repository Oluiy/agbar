import path from "node:path";
import type { SourceFile } from "./types.js";

/**
 * Dependency names only, pulled out of each manifest - never its prose.
 *
 * Rules match manifests by substring (`dependsOnAny`), so reading the whole file
 * let descriptions count as dependencies: BuildQuickPkg's .csproj <Description>
 * says "PostgreSQL" and its release notes mention Microsoft.AspNetCore.OpenApi,
 * so a CLI tool was graded as a Postgres-backed web service. A package.json
 * "description" or a Cargo.toml `description = "..."` can do the same.
 *
 * Each name is emitted quoted on its own line (`"pg"`), which keeps both plain
 * needles (`express`) and exact ones (`'"pg"'`) working.
 */
export function dependencyText(file: SourceFile): string {
  const base = path.basename(file.relPath);
  const names = (list: Iterable<string>) => [...list].map((n) => JSON.stringify(n)).join("\n");

  if (base === "package.json" || base === "composer.json") {
    try {
      const json = JSON.parse(file.content) as Record<string, unknown>;
      const keys = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "require", "require-dev"].flatMap((k) =>
        Object.keys((json[k] as Record<string, unknown>) ?? {})
      );
      return names(keys);
    } catch {
      return ""; // malformed JSON declares nothing we can trust
    }
  }
  if (base.endsWith(".csproj") || base === "Directory.Packages.props") {
    const packages = [...file.content.matchAll(/<(?:Package(?:Reference|Version)|FrameworkReference)\s+[^>]*Include\s*=\s*"([^"]+)"/gi)].map((m) => m[1]);
    // A .NET 6+ web project lists NO Microsoft.AspNetCore package: the framework
    // comes from <Project Sdk="Microsoft.NET.Sdk.Web">. Reading only package
    // references made every plain ASP.NET Core service invisible - its rate-limit
    // and health-endpoint rules were silently skipped.
    const sdk = /<Project\s[^>]*Sdk\s*=\s*"([^"]+)"/i.exec(file.content)?.[1];
    return names(sdk ? [sdk, ...packages] : packages);
  }
  if (base === "pom.xml") {
    return file.content.replace(/<(description|name|url)>[\s\S]*?<\/\1>/gi, "");
  }
  if (base.endsWith(".toml")) {
    // Cargo.toml / pyproject.toml: drop the metadata keys whose values are prose.
    return file.content.replace(/^\s*(description|keywords|authors|readme|homepage|documentation|repository|license|categories)\s*=.*$/gim, "");
  }
  // go.mod, requirements.txt, Gemfile, build.gradle: already just dependency lines.
  return file.content;
}

const FRONTEND = ["react", "react-dom", "vue", "@angular/core", "svelte", "solid-js", "preact", "vite", "react-native", "expo"];
const SERVER = ["express", "fastify", "koa", "@nestjs/core", "hono", "@hapi/hapi", "restify"];

/**
 * A browser/mobile app with no server of its own: every JS/TS file in it runs on
 * the client. Found on three real admin dashboards (Vite + React): `axios.create`
 * in src/api/client.ts was asked for a server-side timeout, because only folder
 * names like static/ or public/ marked code as client-side. Next.js is a frontend
 * *with* a server, so its route handlers (app/**\/route.ts, pages/api/) stay server code.
 */
function isFrontendPackage(pkg: SourceFile): boolean {
  let deps: string[] = [];
  try {
    const json = JSON.parse(pkg.content) as Record<string, Record<string, unknown> | undefined>;
    deps = [...Object.keys(json.dependencies ?? {}), ...Object.keys(json.devDependencies ?? {})];
  } catch {
    return false;
  }
  return deps.some((d) => FRONTEND.includes(d) || d === "next") && !deps.some((d) => SERVER.includes(d));
}

/**
 * Every folder whose package.json makes it a frontend app ("" = the repo root).
 * Per folder, not per repo: a monorepo keeps its frontend in `Mamp_Frontend/`
 * or `mobile/` next to a C# or Node backend, and only checking the root
 * package.json missed those - their API clients were graded as server code.
 */
export function frontendRoots(files: SourceFile[]): string[] {
  return files
    .filter((f) => path.basename(f.relPath) === "package.json" && !f.relPath.includes("node_modules/") && isFrontendPackage(f))
    .map((f) => path.dirname(f.relPath).replace(/^\.$/, ""));
}

/**
 * Server code inside a frontend-framework app (Next.js, Remix, ...): route
 * handlers, API routes, and any module that can only run on a server - one that
 * imports a Node built-in or "server-only", declares "use server", or reads a
 * secret from process.env. portfolio-builder's src/lib/paystack.ts (imports
 * `crypto`, reads PAYSTACK_SECRET_KEY) was treated as browser code, hiding a
 * real timeout-less call to Paystack.
 */
export function isFrameworkServerFile(file: SourceFile): boolean {
  if (/(^|\/)app\/(.+\/)?route\.(ts|js|mjs)$/.test(file.relPath) || /(^|\/)pages\/api\//.test(file.relPath)) return true;
  const head = file.content.slice(0, 3000);
  return (
    /^\s*["']use server["']/m.test(head) ||
    /from\s+["'](node:[\w/]+|crypto|fs|path|child_process|server-only|net|http|https)["']/.test(head) ||
    // Bundlers only inline variables with a public prefix into client code:
    // NEXT_PUBLIC_ (Next), VITE_ (Vite), REACT_APP_ (Create React App),
    // EXPO_PUBLIC_ (Expo). Reading one of those is client code, not a secret.
    /process\.env\.(?!NEXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_|PUBLIC_|NODE_ENV\b)[A-Z_]{3,}/.test(file.content)
  );
}
