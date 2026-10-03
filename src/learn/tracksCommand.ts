import pc from "picocolors";
import { BACKEND_CONCEPTS } from "../concepts/index.js";
import { attention, command, dim, good, heading, name, nextStep, progress as progressOf, tag } from "../ui/palette.js";
import { statusLabel } from "./learnCommand.js";
import { loadUnits } from "./loader.js";
import { defaultProgressPath, loadProgress, statusFor } from "./progress.js";
import { findTrack, loadTracks, type Track } from "./tracks.js";

/** Lessons on this track, and how many you've finished. Reading steps aren't graded, so they're not counted. */
function trackProgress(track: Track): { lessons: number; done: number; reads: number } {
  const lessonSteps = track.steps.filter((s) => s.unit);
  const done = lessonSteps.filter((s) => statusFor(loadProgress(defaultProgressPath(s.unit!.language)), s.unit!.unitId) === "done").length;
  return { lessons: lessonSteps.length, done, reads: track.steps.length - lessonSteps.length };
}

export function printTracksList(): void {
  const tracks = loadTracks();
  console.log(`\n${heading("Tracks")} ${dim(`${tracks.length} guided paths through the lessons and concepts`)}\n`);
  for (const track of tracks) {
    const { lessons, done } = trackProgress(track);
    const start = track.id === "first-steps" ? `  ${attention("← start here")}` : "";
    const progressText = lessons > 0 ? ` ${dim("·")} ${progressOf(done, lessons)} ${dim("lessons done")}` : "";
    console.log(`  ${name(track.title)}${start}`);
    console.log(`    ${dim(`${track.audience} · ${track.steps.length} steps`)}${progressText}`);
    console.log(`    ${command(`buildquick tracks ${track.id}`)}\n`);
  }
}

/** How far along: a small bar, so progress reads at a glance. */
function bar(done: number, total: number, width = 10): string {
  const filled = total === 0 ? 0 : Math.round((done / total) * width);
  return pc.green("█".repeat(filled)) + pc.dim("░".repeat(width - filled));
}

/** The command and title for a lesson step, using its number - short enough to type. */
function lessonStep(language: string, unitId: string): { title: string; cmd: string } {
  const units = loadUnits(language);
  const at = units.findIndex((u) => u.id === unitId);
  return { title: units[at]?.title ?? unitId, cmd: `buildquick learn ${language} ${at + 1}` };
}

/** Steps hang their command under the title, lined up past the number and status columns. */
const INDENT = " ".repeat(20);

function printStep(track: Track, index: number, isNext: boolean): void {
  const step = track.steps[index];
  const number = `${String(index + 1).padStart(2, " ")}.`;
  const here = isNext ? `  ${attention("← you are here")}` : "";
  const num = isNext ? attention(number) : dim(number);

  if (step.conceptId) {
    const concept = BACKEND_CONCEPTS.find((c) => c.id === step.conceptId);
    // loadTracks() already validated this resolves, so concept is always found here.
    console.log(`  ${num} ${dim("· read       ")} ${name(concept!.title)}${here}`);
    console.log(`${INDENT}${command(`buildquick concepts ${step.conceptId}`)}`);
    return;
  }

  const { language, unitId } = step.unit!;
  const status = statusFor(loadProgress(defaultProgressPath(language)), unitId);
  const { title, cmd } = lessonStep(language, unitId);
  console.log(`  ${num} ${statusLabel(status)} ${name(title)} ${tag(`[${language}]`)}${here}`);
  console.log(`${INDENT}${command(cmd)}`);
}

/**
 * The first graded lesson not yet done. Reading steps can't be tracked (nothing
 * is graded), so "where am I" is measured by lessons.
 */
function nextStepIndex(track: Track): number {
  return track.steps.findIndex((s) => s.unit && statusFor(loadProgress(defaultProgressPath(s.unit.language)), s.unit.unitId) !== "done");
}

export function printTrackDetail(trackId: string): void {
  const tracks = loadTracks();
  const track = findTrack(tracks, trackId);
  if (!track) {
    console.error(pc.red(`No track '${trackId}'.`) + ` Run ${command("buildquick tracks")} to see them all.`);
    process.exitCode = 1;
    return;
  }

  const { lessons, done, reads } = trackProgress(track);
  console.log(`\n${heading(track.title)}`);
  console.log(`${dim(track.audience)}\n`);
  console.log(`${track.description}\n`);
  if (lessons > 0) {
    console.log(
      `${pc.bold("Progress")}  ${bar(done, lessons)}  ${progressOf(done, lessons)} ${dim(`lessons done · ${reads} short read${reads === 1 ? "" : "s"} (reading isn't graded)`)}\n`
    );
  }

  const next = nextStepIndex(track);
  track.steps.forEach((_, i) => printStep(track, i, i === next));

  console.log("");
  if (next === -1 && lessons > 0) {
    console.log(`${good("Every lesson on this track is done.")} ${nextStep("pick another:", "buildquick tracks")}`);
  } else if (next !== -1) {
    console.log(`${pc.bold(pc.green("Next:"))} ${command(lessonStep(track.steps[next].unit!.language, track.steps[next].unit!.unitId).cmd)}`);
  }
}
