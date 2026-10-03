import type { Concept } from "./types.js";

/**
 * Small, easily-overlooked traps in the data itself: text, numbers, time.
 * Each looks trivial in isolation and silently corrupts data in production.
 * Every JavaScript claim here was checked by running it (see the traps course,
 * whose tests execute the same behaviour), and several common write-ups get
 * details wrong - the notes below say which.
 */
export const DATA_TRAP_CONCEPTS: Concept[] = [
  {
    id: "unicode-normalization",
    title: "Unicode normalization (NFC vs NFD)",
    category: "Text & Unicode",
    failureScenario:
      'A user registers as "José" from a browser and later logs in from a macOS app. The two strings look identical but one has é as a single code point (NFC) and the other as e + a combining accent (NFD), so the lookup fails - or a second "José" account gets created.',
    fix: "Normalize every piece of external text to one form - NFC (composed) - at the boundary, before comparing, hashing, storing or indexing it.",
    example: `// Bad: visually identical, not equal
"caf\\u00e9" === "cafe\\u0301";                                    // false
// Good: normalize at the boundary
"caf\\u00e9".normalize("NFC") === "cafe\\u0301".normalize("NFC");  // true`,
    practice: "buildquick learn traps 01-text-traps",
  },
  {
    id: "string-length",
    title: "String length: bytes vs code units vs characters",
    category: "Text & Unicode",
    failureScenario:
      "A display name is truncated with slice(0, 20) and cuts an emoji in half, leaving broken text that later crashes a JSON parser. Or a VARCHAR column counted in bytes rejects a name that passed a character-count check.",
    fix: "Know which length you mean: bytes for storage limits, graphemes for what a person sees. JavaScript's .length counts UTF-16 units, which is neither.",
    example: `const e = "👩🏽‍💻";
e.length;                                      // 7  UTF-16 units
[...e].length;                                 // 4  code points
Buffer.byteLength(e);                          // 15 UTF-8 bytes
[...new Intl.Segmenter().segment(e)].length;   // 1  what a person sees
// Good: truncate by grapheme, not by index
const visible = [...new Intl.Segmenter().segment(name)].slice(0, 20).map((s) => s.segment).join("");`,
    practice: "buildquick learn traps 01-text-traps",
  },
  {
    id: "locale-case-mapping",
    title: "Locale-dependent upper/lower case",
    category: "Text & Unicode",
    failureScenario:
      'A Java service deployed on a server with a Turkish locale checks role.toLowerCase().equals("admin"). Lowercasing "ADMIN" there gives "admın" (dotless ı), the check fails, and admins lose access - or worse, a check meant to deny passes.',
    fix: "For identifiers, keys and comparisons, use locale-independent case mapping. (JavaScript's toLowerCase() is already locale-independent; its toLocaleLowerCase() is not.)",
    example: `In Java:   role.toLowerCase(Locale.ROOT).equals("admin")
In C#:     role.ToLowerInvariant() == "admin"      // or string.Equals(a, b, StringComparison.OrdinalIgnoreCase)
In Go:     strings.EqualFold(role, "admin")
In JS:     "TITLE".toLowerCase()            // "title" - safe
           "TITLE".toLocaleLowerCase("tr")  // "tıtle" - locale-aware`,
  },
  {
    id: "invisible-characters",
    title: "Invisible and zero-width characters",
    category: "Text & Unicode",
    failureScenario:
      'Someone registers "admin\\u200b" - admin plus a zero-width space. It displays exactly like "admin" and passes the uniqueness check, so they can impersonate the real admin. Pasted API keys with a trailing zero-width space fail with no visible reason.',
    fix: "Strip zero-width characters (U+200B-U+200D, U+FEFF) from identifiers at the boundary. trim() removes ordinary and non-breaking spaces but not zero-width ones.",
    example: `"admin\\u200b".trim() === "admin";                              // false - trim misses it
const clean = (s) => s.replace(/[\\u200b-\\u200d\\ufeff]/g, "").trim();
clean("admin\\u200b") === "admin";                               // true`,
    practice: "buildquick learn traps 01-text-traps",
  },
  {
    id: "regex-anchoring",
    title: "Unanchored validation regex",
    category: "Text & Unicode",
    failureScenario:
      'An email check /[\\w.+-]+@[\\w-]+\\.[a-z]{2,}/ accepts "junk user@site.com more junk", because a regex matches anywhere inside the text unless it\'s told otherwise. The garbage goes into the database as a "valid" email.',
    fix: "Anchor validation patterns at both ends: ^...$ (or use a full-match API: Python's re.fullmatch, not re.match or re.search).",
    example: `// Bad: finds a valid-looking email INSIDE the input
/[\\w.+-]+@[\\w-]+\\.[a-z]{2,}/.test("junk a@b.com junk");     // true
// Good: the whole input must be the email
/^[\\w.+-]+@[\\w-]+\\.[a-z]{2,}$/.test("junk a@b.com junk");   // false`,
    practice: "buildquick learn regex 01-anchors-and-escapes",
  },
  {
    id: "redos",
    title: "Catastrophic backtracking (ReDoS)",
    category: "Text & Unicode",
    failureScenario:
      "A pattern with a repeat inside a repeat - (a+)+ or ([a-z]+)* - meets a 30-character input that almost matches. The regex engine tries every way to split it: about a billion attempts. One request pins a CPU core; a few take the service down. Stack Overflow (2016) and Cloudflare (2019) both had outages from a single regex.",
    fix: "Remove nested quantifiers (^(a+)+$ is just ^a+$), put a timeout on regex evaluation of user input (.NET: Regex with a TimeSpan), or use a linear-time engine (RE2, Rust's regex).",
    example: `// Bad: exponential time on "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!"
const slow = /^(a+)+$/;
// Good: same meaning, linear time
const fast = /^a+$/;`,
    practice: "buildquick learn regex 03-regex-that-bites",
  },
  {
    id: "floating-point-money",
    title: "Floating-point money",
    category: "Numbers & Money",
    failureScenario:
      'Prices are floats. 0.1 + 0.2 is 0.30000000000000004, (1.005).toFixed(2) is "1.00", and over thousands of transactions the totals drift a few cents from the bank\'s - a reconciliation that never balances.',
    fix: "Store money as integers in the smallest unit (cents), or use a decimal type: decimal (C#), BigDecimal (Java), Decimal (Python). Never parse money through a float.",
    example: `// Bad
0.1 + 0.2;                  // 0.30000000000000004
// Good: integer cents
const totalCents = 10 + 20; // 30 -> format as "0.30" only for display`,
    practice: "buildquick learn traps 02-number-traps",
  },
  {
    id: "big-integer-ids",
    title: "64-bit IDs in JSON",
    category: "Numbers & Money",
    failureScenario:
      "The API returns a BIGINT id as a JSON number. JavaScript parses it into a double, exact only up to 2^53 - 1, so 182947192837491823 becomes 182947192837491800 - and the client's next update targets a different record, or gets a 404.",
    fix: "Serialize 64-bit integers (Snowflake IDs, BIGINT keys) as strings in APIs.",
    example: `// Bad: silently rounded
JSON.parse('{"id":182947192837491823}').id;     // 182947192837491800
// Good: a string survives intact
JSON.parse('{"id":"182947192837491823"}').id;   // "182947192837491823"`,
    practice: "buildquick learn traps 02-number-traps",
  },
  {
    id: "integer-overflow",
    title: "Integer overflow in (low + high) / 2",
    category: "Numbers & Money",
    failureScenario:
      "A binary search over a very large array computes mid = (low + high) / 2 with 32-bit ints. When low + high passes 2,147,483,647 it wraps negative, and the index throws or reads the wrong element. The bug sat in Java's own binary search for years.",
    fix: "Compute midpoints without adding the two ends: low + (high - low) / 2, or (low + high) >>> 1 in Java.",
    example: `In Java/C#:
  int mid = (low + high) / 2;         // bad: can overflow
  int mid = low + (high - low) / 2;   // good`,
  },
  {
    id: "nan-and-infinity",
    title: "NaN and Infinity propagation",
    category: "Numbers & Money",
    failureScenario:
      "An average divides by a count that is 0. In JavaScript (and floating point generally) that's Infinity or NaN - no error. NaN > 0 and NaN <= 0 are both false, so neither branch of an if/else-if runs, and NaN spreads silently through every total it touches.",
    fix: "Validate inputs before arithmetic, and guard results with Number.isFinite (JS) or math.isfinite (Python) before storing or comparing them.",
    example: `const avg = total / count;      // count = 0 -> Infinity or NaN
NaN > 0;                        // false
NaN <= 0;                       // false - both branches skipped
// Good
if (!Number.isFinite(avg)) throw new Error("no data to average");`,
    practice: "buildquick learn traps 02-number-traps",
  },
  {
    id: "rounding-modes",
    title: "Rounding modes differ by language",
    category: "Numbers & Money",
    failureScenario:
      "A tax spec says \"round half up\". Python's round(2.5) is 2 and C#'s Math.Round(2.5) is 2 (round half to even), while JavaScript's Math.round(2.5) is 3 but Math.round(-2.5) is -2. Two services compute the same invoice and disagree by a cent.",
    fix: "Never rely on the default. Name the rounding mode your spec requires: MidpointRounding.AwayFromZero (C#), RoundingMode.HALF_UP (Java), Decimal.quantize with ROUND_HALF_UP (Python) - on decimal values, not floats.",
    example: `Math.round(2.5);    // 3
Math.round(-2.5);   // -2   (JS rounds halves toward +infinity)
// Python: round(2.5) == 2, round(3.5) == 4, round(2.675, 2) == 2.67`,
    practice: "buildquick learn traps 02-number-traps",
  },
  {
    id: "falsy-zero",
    title: '0 and "" treated as missing',
    category: "Numbers & Money",
    failureScenario:
      "stock = input.stock || 10. A shop sets stock to 0 to stop sales - and the code replaces it with 10, because 0 is falsy. The same bug turns an intentional empty string or false into a default.",
    fix: 'Default only on null/undefined: ?? in JavaScript, "is None" checks in Python - never plain truthiness for values where 0, "" or false are meaningful.',
    example: `const stock = 0;
stock || 10;   // bad: 10
stock ?? 10;   // good: 0`,
    practice: "buildquick learn traps 02-number-traps",
  },
  {
    id: "monotonic-clocks",
    title: "Monotonic vs wall-clock time",
    category: "Time & Dates",
    failureScenario:
      "A timeout is computed as Date.now() - start. NTP corrects the system clock backwards by three seconds mid-request, the elapsed time goes negative, and the retry loop never gives up (or a latency graph shows negative durations).",
    fix: "Measure durations, timeouts and rate-limit windows with a monotonic clock: performance.now() / process.hrtime (Node), time.monotonic() (Python), System.nanoTime() (Java), Stopwatch (.NET), Instant (Rust). Use wall-clock time only for timestamps people read.",
    example: `// Bad: the wall clock can jump
const t0 = Date.now();
// Good: only ever moves forward
const t1 = performance.now();
const elapsedMs = performance.now() - t1;`,
    practice: "buildquick learn traps 03-time-traps",
  },
  {
    id: "daylight-saving-time",
    title: "Daylight saving time: days of 23 and 25 hours",
    category: "Time & Dates",
    failureScenario:
      "A daily job schedules \"tomorrow\" as now + 24 hours. On the spring-forward day it runs an hour late; around fall-back it runs twice - a double billing run. A job scheduled for 02:30 local doesn't run at all on the day that hour doesn't exist.",
    fix: "Store and compute server time in UTC. For human-facing schedules, store the IANA timezone (America/New_York) and add calendar days in that zone, converting to UTC when the job runs.",
    example: `// Bad: an hour off across a DST change
const bad = new Date(start.getTime() + 24 * 60 * 60 * 1000);
// Good: the next calendar day, same local time
const next = new Date(start);
next.setDate(next.getDate() + 1);`,
    practice: "buildquick learn traps 03-time-traps",
  },
  {
    id: "week-based-year",
    title: "YYYY vs yyyy in date formats",
    category: "Time & Dates",
    failureScenario:
      "An invoice template uses YYYY-MM-dd. In Java and many JS/Swift formatting libraries, YYYY is the week-based year. 2024-12-30 is a Monday in week 1 of 2025, so the invoice is dated 2025-12-30 - a year in the future.",
    fix: "Use yyyy (calendar year) for dates. Use YYYY only together with week numbers (2025-W01-1).",
    example: `In Java:
  DateTimeFormatter.ofPattern("yyyy-MM-dd")   // good: calendar year
  DateTimeFormatter.ofPattern("YYYY-MM-dd")   // bad: week-based year -> "2025-12-30" for 2024-12-30`,
  },
  {
    id: "leap-days",
    title: "Leap days: February 29 plus one year",
    category: "Time & Dates",
    failureScenario:
      "An annual subscription renews on date.Year + 1. For a sign-up on 2024-02-29, .NET's new DateTime(2025, 2, 29) throws and the renewal job crashes; in JavaScript, setFullYear(2025) silently rolls over to March 1 - no error, wrong date.",
    fix: "Use calendar-aware methods that clamp to the last valid day (AddYears in .NET, relativedelta in Python), and test date code on a real February 29.",
    example: `const d = new Date(Date.UTC(2024, 1, 29));
d.setUTCFullYear(2025);
d.toISOString().slice(0, 10);   // "2025-03-01" - silently not Feb 28`,
    practice: "buildquick learn traps 03-time-traps",
  },
];
