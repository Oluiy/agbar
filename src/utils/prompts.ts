import { cancel, isCancel } from "@clack/prompts";

/**
 * Unwraps a @clack/prompts answer: on Ctrl-C it says so and exits instead of returning the
 * cancel symbol. One copy for every stack's prompts, so "what happens on Ctrl-C" cannot
 * differ between stacks.
 */
export function checkCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Cancelled.");
    process.exit(1);
  }
  return value;
}
