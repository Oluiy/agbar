import { runCommand, type CommandResult } from "../utils/runCommand.js";
import type { RunContext } from "./StackAdapter.js";

export interface StepOptions {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Binds a working directory and a RunContext once, so every install stage is one line:
 * it announces itself to the user ("installing packages") and can be cancelled. Shared by
 * all adapters, so none of them re-implements progress or cancellation wiring.
 */
export function stepRunner(context: RunContext, cwd: string) {
  return (label: string, command: string, args: string[], { timeoutMs, env }: StepOptions = {}): Promise<CommandResult> => {
    context.step(label);
    return runCommand(command, args, cwd, { timeoutMs, env, signal: context.signal });
  };
}
