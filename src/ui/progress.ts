import { bad, dim, good } from "./palette.js";

/**
 * What the engine says while a long phase runs. An interface, so orchestration logic (the
 * engine) never touches a terminal and tests record calls instead of parsing escape codes.
 */
export interface Reporter {
  /** A phase begins (`message` is its heading). */
  start(message: string): void;
  /** What the phase is doing right now: "installing packages". */
  step(label: string): void;
  /** The phase finished well. */
  succeed(message: string): void;
  /** The phase failed or was cancelled. */
  fail(message: string): void;
}

/** "75" -> "1:15". Elapsed time, so a quiet installer does not look like a frozen program. */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Shortens `text` to at most `width` characters, ending in an ellipsis when it had to cut. */
export function fitToWidth(text: string, width: number): string {
  const max = Math.max(1, width);
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface TerminalReporterOptions {
  stream?: NodeJS.WriteStream;
  /** Injected so tests need no real timers. */
  now?: () => number;
  /** How often the animated line redraws. */
  tickMs?: number;
}

/**
 * A spinner with an elapsed clock, on a plain stream.
 *
 * Deliberately not @clack/prompts' spinner: that one installs its own SIGINT handler which
 * stops the spinner and calls process.exit - before the engine can clean up a half-written
 * project or stop an installer. Here Ctrl-C belongs to the caller.
 *
 * Without a TTY (CI, a pipe) it prints one plain line per step instead of redrawing, so logs
 * stay readable.
 */
export function createTerminalReporter({ stream = process.stdout, now = Date.now, tickMs = 100 }: TerminalReporterOptions = {}): Reporter {
  const interactive = Boolean(stream.isTTY);
  let timer: NodeJS.Timeout | undefined;
  let heading = "";
  let current = "";
  let startedAt = 0;
  let frame = 0;

  // The animated line must fit on ONE terminal row: \r\x1b[2K clears only the row the cursor is
  // on, so a line that wraps leaves its first row behind on every redraw and the screen fills up.
  const line = () => {
    const clock = `(${formatElapsed((now() - startedAt) / 1000)})`;
    const label = fitToWidth(`${heading}${current ? ` - ${current}` : ""}`, (stream.columns ?? 80) - clock.length - 4);
    return `${FRAMES[frame % FRAMES.length]} ${label} ${dim(clock)}`;
  };

  const draw = () => {
    frame++;
    stream.write(`\r\x1b[2K${line()}`);
  };

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (interactive) stream.write("\r\x1b[2K");
  };

  return {
    start(message) {
      heading = message;
      current = "";
      startedAt = now();
      if (!interactive) {
        stream.write(`${message}\n`);
        return;
      }
      draw();
      timer = setInterval(draw, tickMs);
      // A leftover animation must never keep the process alive.
      timer.unref();
    },
    step(label) {
      current = label;
      if (!interactive) stream.write(`  ${label}\n`);
    },
    succeed(message) {
      stop();
      stream.write(`${good("✔")} ${message} ${dim(`(${formatElapsed((now() - startedAt) / 1000)})`)}\n`);
    },
    fail(message) {
      stop();
      stream.write(`${bad("✖")} ${message}\n`);
    },
  };
}
