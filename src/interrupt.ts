/**
 * Ctrl-C handling for a long-running phase, kept out of the engine and the adapters: they only
 * obey an AbortSignal; the CLI (the composition root) decides what a Ctrl-C means.
 *
 *   first Ctrl-C  -> abort the signal: the engine stops the installer and cleans up or keeps the
 *                    project as appropriate, then returns control normally
 *   second Ctrl-C -> the user is impatient or something is stuck: exit now (130 = 128 + SIGINT)
 *
 * Returns a function that removes the handler, so it only exists while a phase is running.
 */
export interface InterruptHost {
  on(event: "SIGINT", listener: () => void): unknown;
  off(event: "SIGINT", listener: () => void): unknown;
  exit(code: number): never | void;
}

export function abortOnInterrupt(controller: AbortController, onFirst: () => void, host: InterruptHost = process): () => void {
  let presses = 0;
  const handler = () => {
    presses++;
    if (presses === 1) {
      controller.abort();
      onFirst();
      return;
    }
    host.exit(130);
  };
  host.on("SIGINT", handler);
  return () => host.off("SIGINT", handler);
}
