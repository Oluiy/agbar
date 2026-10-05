import path from "node:path";
import type { ScaffoldConfig } from "../../config.js";
import { writeFile } from "../../utils/fsWrite.js";
import type { StackAdapter } from "../StackAdapter.js";
import { promptSpringBootAddons, resolveSpringBootAddons } from "./addons.js";
import { bootstrapWithInitializr, removeInitializrDefaults } from "./bootstrap.js";
import { generateMultiModuleSet } from "./multiModule.js";
import { generateSingleModuleSet } from "./singleModule.js";
import { gitignore } from "./templates/gitignore.js";
import { writeMavenWrapper } from "./templates/mavenWrapper.js";
import { microserviceAggregatorPom } from "./templates/pom.js";
import type { ProjectStructure, SpringBootAddons } from "./types.js";

/**
 * The Spring Boot StackAdapter itself - deliberately thin. It decides monolith
 * vs. microservice and which structure generator to call; everything else lives
 * in a module of its own:
 *
 *   addons.ts       - prompts and flag/config validation
 *   multiModule.ts  - the separate-Maven-modules structure
 *   singleModule.ts - Package-by-Layer and Package-by-Feature
 *   layout.ts       - the Java sources every structure shares
 *   types.ts        - the shapes all of the above agree on
 */

async function generateOne(
  structure: ProjectStructure,
  projectName: string,
  outDir: string,
  isFourLayer: boolean,
  includeTests: boolean,
  httpPort: number,
  addons: SpringBootAddons
): Promise<void> {
  if (structure === "multi-module") {
    // Initializr generates a single Maven project, so there is nothing it can
    // contribute here - this path stays hand-written by necessity.
    await generateMultiModuleSet(projectName, outDir, isFourLayer, includeTests, httpPort, addons);
    return;
  }

  // Ask Spring for the build first. When it answers, its pom.xml, Maven wrapper
  // and .gitignore are kept and only the Java sources are overlaid.
  const fromInitializr = addons.useInitializr ? await bootstrapWithInitializr(outDir, projectName, addons) : false;
  if (fromInitializr) removeInitializrDefaults(outDir, projectName);

  await generateSingleModuleSet(structure, projectName, outDir, includeTests, httpPort, addons, fromInitializr);
}

export const springbootAdapter: StackAdapter = {
  id: "springboot",
  label: "Spring Boot (Java + Maven)",

  promptAddons: promptSpringBootAddons,
  resolveAddons: resolveSpringBootAddons,

  capabilities: { jwt: true, layers: true },

  nextSteps: (config) => [`cd ${config.projectName}`, "mvn test", "mvn spring-boot:run"],

  async generate(config: ScaffoldConfig, outDir: string): Promise<void> {
    const addons = config.addons as unknown as SpringBootAddons;

    if (config.isMicroservice) {
      const servicesDir = path.join(outDir, "services");
      for (const serviceName of config.serviceNames) {
        await generateOne(addons.structure, serviceName, path.join(servicesDir, serviceName), addons.isFourLayer, config.includeTests, config.httpPort, addons);
      }
      // A lightweight reactor root so "mvn install" from here builds every
      // service in one shot; each service stays fully independent underneath.
      writeFile(path.join(outDir, "pom.xml"), microserviceAggregatorPom(config.projectName.toLowerCase(), config.serviceNames));
      writeFile(path.join(outDir, "README.md"), `# ${config.projectName}\n\nGenerated with \`buildquick\` (Spring Boot, microservices).\n`);
      writeFile(path.join(outDir, ".gitignore"), gitignore());
      writeMavenWrapper(outDir);
    } else {
      await generateOne(addons.structure, config.projectName, outDir, addons.isFourLayer, config.includeTests, config.httpPort, addons);
    }
  },
};
