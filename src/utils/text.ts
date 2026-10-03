/**
 * The last `lines` lines of a command's output - where the useful part of pip, npm, cargo
 * and test runners lives. Used to report a failed install or test without dumping hundreds
 * of lines of progress.
 */
export function tail(text: string, lines = 16): string {
  return text.trimEnd().split("\n").slice(-lines).join("\n");
}
