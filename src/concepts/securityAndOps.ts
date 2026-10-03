import type { Concept } from "./types.js";

/** Keeping it safe, and being able to tell what it's doing in production. */
export const SECURITY_AND_OPS_CONCEPTS: Concept[] = [
  {
    id: "security-by-design",
    example: `// Bad: user input becomes part of the SQL - an injection waiting to happen
db.query(\`SELECT * FROM users WHERE email = '\${req.query.email}'\`);

// Good: input is always data, never code
db.query("SELECT * FROM users WHERE email = $1", [req.query.email]);

// And least privilege: the app's DB user can't DROP TABLE, so a bug can't either.`,
    title: "Security by design",
    category: "Security",
    failureScenario:
      "An endpoint checks that a request is authenticated but not that the authenticated user actually owns the resource being requested - so user A can read or edit user B's data just by changing an ID in the URL.",
    fix: "Treat authentication (who is this?) and authorization (are they allowed to do this?) as two separate, mandatory checks on every request. Encrypt sensitive data at rest and in transit, and check new endpoints against the OWASP Top 10 before shipping, not after an audit finds it.",
  },
  {
    id: "observability",
    example: `// A health endpoint that checks a real dependency, not just "process is up"
app.get("/healthz", async (req, res) => {
  try { await db.query("SELECT 1"); res.status(200).send("ok"); }
  catch { res.status(503).send("database unreachable"); }
});`,
    title: "Observability",
    category: "Operations",
    failureScenario:
      "A service starts failing in production. The only available signal is 'users are complaining' - no structured logs, no metrics, no way to trace one failing request through the five services it touched.",
    fix: "Emit structured logs, metrics, and distributed traces as the system runs, not just error messages when it crashes. The goal is answering 'what happened, where, and why' from data already being collected, instead of reproducing the bug live.",
  },
  {
    id: "rate-limiting",
    example: `// Express: one middleware in front of every route
import rateLimit from "express-rate-limit";
app.use(rateLimit({ windowMs: 60_000, limit: 100 }));   // 100 req/min per client

// Go (Fiber)
app.Use(limiter.New(limiter.Config{Max: 100, Expiration: time.Minute}))`,
    practice: "buildquick learn algorithms 01-token-bucket",
    title: "Rate limiting",
    category: "Security",
    failureScenario:
      "A login endpoint has no limit on failed attempts, so a bot can try thousands of password guesses a minute - or one misbehaving client script accidentally loops a request and takes the endpoint down for every other user.",
    fix: "Cap how many requests a client (by IP, API key, or user) can make in a given window, and return 429 once they exceed it. Protects against both attackers and your own client bugs, for a lot less than the cost of the outage it prevents.",
    whenToUse:
      "On every public endpoint, but the interesting decision is which algorithm, and it reduces to one question: do legitimate clients burst? If yes - mobile apps waking up, batch jobs, connection-pooled clients - use a token bucket, which allows a bounded burst while capping the sustained rate (what Stripe, GitHub and AWS use for public APIs). If no, and an even rate matters more than tolerating spikes, use a sliding window counter, which avoids the boundary exploit that lets fixed windows pass double the limit across two adjacent windows. The cost difference is state: fixed window keeps one integer per client, a sliding window log keeps a timestamp per request.",
    references: [
      { title: "Rate-limiting algorithms compared", url: "https://blog.arcjet.com/rate-limiting-algorithms-token-bucket-vs-sliding-window-vs-fixed-window/" },
      { title: "Build 5 rate limiters with Redis", url: "https://redis.io/tutorials/howtos/ratelimiting/" },
    ],
  },
  {
    id: "secrets-management",
    example: `// Bad: the password is now in git history forever
//   const db = connect("postgres://app:changeme@db:5432/prod");

// Good: read it from the environment at runtime
const db = connect(process.env.DATABASE_URL);
// and list .env in .gitignore so the local copy never gets committed`,
    title: "Secrets management",
    category: "Security",
    failureScenario:
      "A database password or API key gets hardcoded into a config file that's committed to git - now it's in the repo's history forever, visible to anyone with clone access, long after anyone remembers it's there.",
    fix: "Keep secrets out of source control entirely: environment variables sourced from a secrets manager or vault, never hardcoded, never committed, rotated when someone with access leaves. A `.env` file still needs to be in `.gitignore`, not just 'not committed yet.'",
  },
  {
    id: "feature-flags",
    example: `if (await flags.isEnabled("new-checkout", { userId: user.id })) {
  return newCheckout(cart);   // good: on for 5% of users, reversible without a deploy
}
return oldCheckout(cart);

// Once it's at 100%, delete the flag AND the old path. Stale flags turn
// into branches nobody dares remove.`,
    title: "Feature flags",
    category: "Operations",
    failureScenario:
      "A new checkout flow ships and starts failing for 3% of users. Turning it off means reverting the commit, rebuilding, and running the full deploy pipeline - twenty-five minutes during which it keeps failing. Worse, the revert also removes three unrelated fixes that shipped in the same release.",
    fix: "Decouple deploy from release. Ship the code dark behind a flag, then turn it on independently - for internal users first, then a percentage, then everyone. Turning it back off is a config change measured in seconds, not a deploy. It also makes trunk-based development practical: unfinished work can merge safely because it's switched off.",
    whenToUse:
      "Worth it for risky changes, gradual rollouts, and anything you'd want to disable without a deploy. Not worth it for every change - each flag is a branch in your code and a combination you theoretically have to test. Flags are inventory: give every one an owner and a removal date, or in two years you'll have a hundred stale ones nobody dares delete.",
    references: [{ title: "Feature toggles (Martin Fowler)", url: "https://martinfowler.com/articles/feature-toggles.html" }],
  },
];
