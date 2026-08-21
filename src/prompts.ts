import { cancel, confirm, intro, isCancel, select, text } from "@clack/prompts";
import type { ScaffoldConfig } from "./config.js";
import type { StackAdapter } from "./stacks/StackAdapter.js";
import { isValidIdentifierName } from "./utils/nameValidation.js";

function bail(): never {
  cancel("Cancelled.");
  process.exit(1);
}

function checkCancel<T>(value: T | symbol): T {
  if (isCancel(value)) bail();
  return value as T;
}

/**
 * Prompts for every setting genuinely shared across stacks, then delegates to the chosen
 * adapter's own addon prompts. Deliberately does NOT ask a generic "architecture pattern"
 * question here: what "more/fewer layers" even means (separate Maven modules for Spring
 * Boot, a Cargo workspace vs. single crate for Rust, or nothing at all for a stack with no
 * such concept) is stack-specific mechanics, not a universal concept - each adapter that
 * needs it asks its own version inside promptAddons().
 */
export async function runPrompts(
  stacks: StackAdapter[],
  projectNameArg?: string
): Promise<{ config: ScaffoldConfig; adapter: StackAdapter }> {
  intro("buildquick - universal backend scaffolder");

  let projectName: string;
  if (projectNameArg) {
    const trimmed = projectNameArg.trim();
    if (!isValidIdentifierName(trimmed)) {
      cancel(`'${projectNameArg}' isn't a valid project name. Use only letters, digits, and underscores, starting with a letter.`);
      process.exit(1);
    }
    projectName = trimmed;
  } else {
    const answer = checkCancel(
      await text({
        message: "What is your project name?",
        placeholder: "MyAwesomeApi",
        defaultValue: "MyAwesomeApi",
        validate: (value) => {
          const trimmed = (value || "MyAwesomeApi").trim();
          if (!isValidIdentifierName(trimmed)) {
            return "Use only letters, digits, and underscores, starting with a letter.";
          }
        },
      })
    );
    projectName = (answer || "MyAwesomeApi").trim();
  }

  const stackId = checkCancel(
    await select({
      message: "Choose your stack:",
      options: stacks.map((s) => ({ value: s.id, label: s.label })),
    })
  );
  const adapter = stacks.find((s) => s.id === stackId)!;

  const deploymentChoice = checkCancel(
    await select({
      message: "Deployment Style:",
      options: [
        { value: "mono", label: "Monolithic (single solution)" },
        { value: "micro", label: "Microservice (multiple independent services)" },
      ],
    })
  );
  const isMicroservice = deploymentChoice === "micro";

  const serviceNames: string[] = [];
  if (isMicroservice) {
    const countRaw = checkCancel(
      await text({
        message: "How many services would you like to create?",
        defaultValue: "2",
        validate: (value) => {
          const n = Number(value);
          if (!Number.isInteger(n) || n < 1) return "Enter at least 1 service.";
        },
      })
    );
    const count = Number(countRaw || "2");
    for (let i = 1; i <= count; i++) {
      const name = checkCancel(
        await text({
          message: `What is the name of service ${i}?`,
          defaultValue: `Service${i}`,
          validate: (value) => {
            const trimmed = (value || `Service${i}`).trim();
            if (!isValidIdentifierName(trimmed)) {
              return "Use only letters, digits, and underscores, starting with a letter.";
            }
          },
        })
      );
      serviceNames.push((name || `Service${i}`).trim());
    }
  }

  const includeTests = checkCancel(
    await confirm({
      message: "Include a starter test project for endpoints?",
      initialValue: true,
    })
  );

  const portRaw = checkCancel(
    await text({
      message: "What is your Port?",
      defaultValue: "8080",
      validate: (value) => {
        const n = Number(value || "8080");
        if (!Number.isInteger(n) || n <= 0) return "Enter a valid port number.";
      },
    })
  );

  // Cross-stack on purpose: unlike architecture/deployment mechanics, "does
  // this call an LLM API" means the same thing regardless of stack, and drives
  // the ai-cost-guard recommendation after generation either way - including
  // for the ASP.NET Core wrapper, which otherwise has no addons of its own.
  const usesLlmApi = checkCancel(
    await confirm({
      message: "Will this project call an LLM API (OpenAI, Anthropic, Groq, ...)?",
      initialValue: false,
    })
  );

  const addons = await adapter.promptAddons();

  const config: ScaffoldConfig = {
    projectName,
    outputDirectory: process.cwd(),
    includeTests,
    isMicroservice,
    serviceNames,
    httpPort: Number(portRaw || "8080"),
    usesLlmApi,
    addons,
  };

  return { config, adapter };
}
