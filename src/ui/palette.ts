import os from "node:os";
import pc from "picocolors";

/**
 * The one palette. Every colour in agbar's output is a role defined here -
 * one meaning per colour, the same in every command - the way Idari's style.rs
 * does it. Screens say what a thing IS (a command, a path, a title); this file
 * decides how it looks. To restyle agbar, change this file.
 *
 *   heading    bold underline   section titles: where the eye lands first
 *   name       bright cyan      the thing a line is about: a lesson, concept, track
 *   command    green            something to type - advice to act on
 *   path       blue             files and locations
 *   count      bold             numbers that rank or measure a row
 *   tag        magenta          what kind of thing it is: [yaml], [read], [core]
 *   attention  bright yellow    look here first: "you are here", key points
 *   good / bad green / red      passed / failed, right / wrong code
 *   dim                         asides and explanations
 *
 * Colour never stands alone: each role decorates text that already says the
 * same thing ("not started", "←", "Next:"), so piped, colour-blind or NO_COLOR
 * output loses nothing. picocolors strips colour when stdout isn't a terminal.
 */

export const heading = (s: string): string => pc.bold(pc.underline(s));
export const name = (s: string): string => pc.bold(pc.cyanBright(s));
export const command = (s: string): string => pc.green(s);
export const path = (s: string): string => pc.blue(s);
export const count = (s: string | number): string => pc.bold(String(s));
export const tag = (s: string): string => pc.magenta(s);
export const attention = (s: string): string => pc.bold(pc.yellowBright(s));
export const good = (s: string): string => pc.green(s);
export const bad = (s: string): string => pc.red(s);
export const dim = (s: string): string => pc.dim(s);
export const label = (s: string): string => pc.bold(s);

/** A labelled next step: bold "Next:" then the command. The end of almost every screen. */
export const nextStep = (what: string, cmd: string): string => `${pc.bold(pc.green("Next:"))} ${what} ${command(cmd)}`;

/** A path with the home folder shown as ~ - a 100-character temp path hides the one thing you need. */
export function shortPath(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

/** A thin rule under a section heading, so sections separate at a glance. */
export const rule = (width = 60): string => pc.dim("─".repeat(width));

/** "3 of 9" with the finished part coloured - a progress reading that takes no thought. */
export function progress(done: number, total: number): string {
  return `${done === total && total > 0 ? good(String(done)) : count(String(done))} ${dim("of")} ${count(String(total))}`;
}
