/**
 * Generates one project with a real stack adapter, for CI to install, test and build.
 *
 *   npx tsx scripts/generate-scaffold.ts <stack> <outDir> '<addons json>'
 *
 * Used by .github/workflows/scaffold-verify.yml. It generates only - installing and
 * testing are separate workflow steps, so a failure says which step broke.
 */
import path from "node:path";
import { noopContext } from "../src/stacks/StackAdapter.js";
import { expressAdapter, fastifyAdapter } from "../src/stacks/node/adapter.js";
import { nestjsAdapter } from "../src/stacks/nestjs/adapter.js";
import { springbootAdapter } from "../src/stacks/springboot/adapter.js";
import type { StackAdapter } from "../src/stacks/StackAdapter.js";

const ADAPTERS: Record<string, StackAdapter> = {
  express: expressAdapter,
  fastify: fastifyAdapter,
  nestjs: nestjsAdapter,
  springboot: springbootAdapter,
};

const [stack, outDirArg, addonsJson] = process.argv.slice(2);
const adapter = stack ? ADAPTERS[stack] : undefined;
if (!adapter || !outDirArg || !addonsJson) {
  console.error(`usage: generate-scaffold <${Object.keys(ADAPTERS).join("|")}> <outDir> '<addons json>'`);
  process.exit(2);
}

const outDir = path.resolve(outDirArg);
// resolveAddons validates and fills defaults exactly as `buildquick --yes` would; install
// is forced off because the workflow runs those steps itself.
const addons = adapter.resolveAddons({ ...JSON.parse(addonsJson), install: false });

await adapter.generate(
  {
    projectName: "Verify",
    outputDirectory: path.dirname(outDir),
    includeTests: true,
    isMicroservice: false,
    serviceNames: [],
    httpPort: 3000,
    usesLlmApi: false,
    addons,
  },
  outDir,
  noopContext
);
console.log(`generated ${stack} ${JSON.stringify(addons)} -> ${outDir}`);
