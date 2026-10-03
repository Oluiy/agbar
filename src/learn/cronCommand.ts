import pc from "picocolors";
import { nextFireTimes } from "./cron.js";

/**
 * `buildquick cron "<expr>"` - the fastest way to find out whether a schedule
 * means what you think. Reading cron is error-prone; seeing the actual next
 * run times is not.
 */
export function printCronSchedule(expression: string, count: number, now: Date = new Date()): void {
  let times: Date[];
  try {
    times = nextFireTimes(expression, now, Number.isInteger(count) && count > 0 ? count : 5);
  } catch (err) {
    console.error(pc.red((err as Error).message));
    process.exitCode = 1;
    return;
  }

  if (times.length === 0) {
    console.log(pc.yellow(`'${expression}' never fires in the next year (e.g. Feb 30th) - check the day and month fields.`));
    return;
  }

  console.log(pc.bold(`Next runs of '${expression}':`));
  for (const t of times) {
    const utc = t.toISOString().replace("T", " ").slice(0, 16);
    const weekday = t.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
    console.log(`  ${weekday} ${utc} UTC   ${pc.dim(`(your time: ${t.toLocaleString()})`)}`);
  }
  console.log(pc.dim("\nGitHub Actions evaluates schedules in UTC by default, and runs may start late at busy times."));
  console.log(pc.dim("Lesson: buildquick learn yaml 03-cron-schedules"));
}
