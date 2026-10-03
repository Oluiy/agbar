/**
 * A 5-field cron evaluator: `minute hour day-of-month month day-of-week`,
 * evaluated in UTC - the syntax GitHub Actions `schedule:` uses, and the clock
 * it runs on by default.
 *
 * Written by hand rather than pulled in as a dependency because it is small,
 * and because the lessons grade *meaning*: "does this expression fire at
 * 09:30 on a Monday?" accepts `30 9 * * 1-5` and `30 9 * * MON-FRI` alike,
 * which string comparison never could.
 */

interface FieldSpec {
  name: string;
  min: number;
  max: number;
  names?: string[];
}

const FIELDS: FieldSpec[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, names: ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] },
  // 0-6 with Sunday = 0, as GitHub documents it.
  { name: "day-of-week", min: 0, max: 6, names: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] },
];

export interface CronSchedule {
  fields: Set<number>[];
  domRestricted: boolean;
  dowRestricted: boolean;
}

function parseValue(text: string, spec: FieldSpec): number {
  const nameIndex = spec.names?.indexOf(text.toUpperCase()) ?? -1;
  if (nameIndex >= 0) return nameIndex + spec.min;
  if (!/^\d+$/.test(text)) throw new Error(`${spec.name}: '${text}' isn't a number${spec.names ? " or a name like " + spec.names[1] : ""}.`);
  const value = Number(text);
  if (value < spec.min || value > spec.max) throw new Error(`${spec.name} must be ${spec.min}-${spec.max}, got ${value}.`);
  return value;
}

function parseField(text: string, spec: FieldSpec): Set<number> {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const pieces = part.split("/");
    if (pieces.length > 2) throw new Error(`${spec.name}: '${part}' has more than one '/'.`);
    const [rangeText, stepText] = pieces;
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`${spec.name}: step '${stepText}' must be a whole number of 1 or more.`);

    let low: number;
    let high: number;
    if (rangeText === "*") {
      [low, high] = [spec.min, spec.max];
    } else if (rangeText.includes("-")) {
      const [a, b] = rangeText.split("-");
      [low, high] = [parseValue(a, spec), parseValue(b, spec)];
      if (low > high) throw new Error(`${spec.name}: range '${rangeText}' runs backwards.`);
    } else {
      low = parseValue(rangeText, spec);
      // `5/15` means "from 5, every 15" - to the end of the field.
      high = stepText === undefined ? low : spec.max;
    }
    for (let v = low; v <= high; v += step) values.add(v);
  }
  return values;
}

/** Throws a message naming the field at fault - these are shown to learners. */
export function parseCron(expr: string): CronSchedule {
  const parts = expr.trim().split(/\s+/);
  // `@daily`-style shortcuts work in some crons but not in GitHub Actions - say
  // what to write instead, rather than just "wrong number of fields".
  const macros: Record<string, string> = {
    "@yearly": "0 0 1 1 *",
    "@annually": "0 0 1 1 *",
    "@monthly": "0 0 1 * *",
    "@weekly": "0 0 * * 0",
    "@daily": "0 0 * * *",
    "@midnight": "0 0 * * *",
    "@hourly": "0 * * * *",
  };
  const macro = macros[expr.trim().toLowerCase()];
  if (macro) {
    throw new Error(`'${expr.trim()}' is a shortcut GitHub Actions doesn't accept. Write the five fields instead: '${macro}'.`);
  }
  if (parts.length !== 5) {
    throw new Error(`A cron expression has exactly 5 fields (minute hour day-of-month month day-of-week); '${expr}' has ${parts.length}.`);
  }
  return {
    fields: parts.map((part, i) => parseField(part, FIELDS[i])),
    // Classic cron rule: when BOTH day fields are restricted, a day matches if
    // EITHER does. `0 9 1 * MON` fires on the 1st *and* on every Monday - one
    // of the most surprising things in cron, so it's modelled, not ignored.
    domRestricted: !parts[2].startsWith("*"),
    dowRestricted: !parts[4].startsWith("*"),
  };
}

export function cronMatches(schedule: CronSchedule, date: Date): boolean {
  const [minute, hour, dom, month, dow] = schedule.fields;
  if (!minute.has(date.getUTCMinutes()) || !hour.has(date.getUTCHours()) || !month.has(date.getUTCMonth() + 1)) return false;
  const domOk = dom.has(date.getUTCDate());
  const dowOk = dow.has(date.getUTCDay());
  return schedule.domRestricted && schedule.dowRestricted ? domOk || dowOk : domOk && dowOk;
}

/** The next `count` fire times strictly after `from`, searching up to a year ahead. */
export function nextFireTimes(expr: string, from: Date, count: number): Date[] {
  const schedule = parseCron(expr);
  const out: Date[] = [];
  const t = new Date(from);
  t.setUTCSeconds(0, 0);
  const limit = 366 * 24 * 60;
  for (let i = 0; i < limit && out.length < count; i++) {
    t.setUTCMinutes(t.getUTCMinutes() + 1);
    if (cronMatches(schedule, t)) out.push(new Date(t));
  }
  return out;
}
