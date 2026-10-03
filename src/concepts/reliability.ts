import type { Concept } from "./types.js";

/** Staying up, and degrading sanely when something downstream doesn't. */
export const RELIABILITY_CONCEPTS: Concept[] = [
  {
    id: "idempotency-keys",
    example: `app.post("/withdrawals", async (req, res) => {
  const key = req.header("Idempotency-Key");
  const seen = await idempotency.find(key);
  if (seen) return res.status(seen.status).json(seen.body);   // good: replay, don't redo

  const result = await withdraw(req.body);
  await idempotency.save({ key, status: 201, body: result });
  res.status(201).json(result);
});
// Make "key" a UNIQUE column, so two concurrent retries can't both get past find().`,
    title: "Idempotency keys",
    category: "Reliability",
    failureScenario:
      "A user's withdrawal request times out on the client, so they click the button again - maybe a third time. Without protection, your system processes all three as separate withdrawals.",
    fix: "Attach a unique idempotency key to the request. If the same key arrives again, return the original result instead of processing it a second time. Standard in any payment API, because retries and timeouts are guaranteed to happen, not just possible.",
  },
  {
    id: "retry-mechanisms",
    title: "Retry mechanisms (exponential backoff)",
    category: "Reliability",
    failureScenario: "A downstream provider blips for two seconds. With no retry, that two-second blip becomes a permanent failure the user actually sees.",
    fix: "Retry transient failures automatically, waiting longer between each attempt (exponential backoff) instead of hammering an already-struggling service harder. Give up and surface the failure only after a bounded number of tries.",
    example: `// Bad: retries instantly, forever - turns a blip into a self-inflicted outage
while (true) { try { return await call(); } catch {} }

// Good: bounded attempts, growing waits, random jitter
for (let attempt = 0; attempt < 5; attempt++) {
  try { return await call(); }
  catch { await sleep(Math.random() * 100 * 2 ** attempt); }
}
throw new Error("gave up after 5 attempts");`,
    practice: "buildquick learn algorithms 02-exponential-backoff",
  },
  {
    id: "timeouts",
    title: "Timeouts",
    category: "Reliability",
    failureScenario:
      "A payment provider stops responding - not failing, just hanging. Your outbound calls have no timeout, so each one waits forever. Within minutes every request thread or connection is stuck waiting, and your whole service is down because of someone else's slow API.",
    fix: "Put an explicit timeout on every call that leaves your process: HTTP, database, cache. Most clients default to waiting forever, so the absence of a timeout is itself the bug. Pick a value from what the caller can tolerate (well under your own users' patience), and treat a timeout as a failure you retry or report - never as something to wait out.",
    example: `// JavaScript: fetch waits forever by default
await fetch(url);                                            // bad
await fetch(url, { signal: AbortSignal.timeout(3000) });     // good: 3s

// Go: http.Get uses a client with no timeout
http.Get(url)                                                // bad
client := &http.Client{Timeout: 3 * time.Second}             // good
client.Get(url)

# Python: requests has no default timeout
requests.get(url)                                            # bad
requests.get(url, timeout=3)                                 # good`,
  },
  {
    id: "dead-letter-queues",
    example: `async function handle(message) {
  try {
    await process(message.body);
    await message.ack();
  } catch (err) {
    if (message.attempts >= 5) {
      // Good: keep it for a human to inspect - bad would be dropping it here
      await deadLetters.publish({ ...message.body, error: String(err) });
      await message.ack();
    } else {
      await message.retry({ delayMs: 1000 * 2 ** message.attempts });
    }
  }
}`,
    title: "Dead letter queues",
    category: "Reliability",
    failureScenario:
      "A background job keeps failing past its retry limit, and a naive queue just drops it. The failure is invisible until a customer complains that something never happened.",
    fix: "Route jobs that exhaust their retries into a separate dead letter queue instead of discarding them, so someone can inspect what actually went wrong later, instead of losing the request entirely.",
  },
  {
    id: "circuit-breakers",
    example: `// After 5 failures, stop calling for 30s and fail fast instead of queuing
import CircuitBreaker from "opossum";
const breaker = new CircuitBreaker(callPaymentApi, {
  timeout: 3000, errorThresholdPercentage: 50, resetTimeout: 30_000,
});
const result = await breaker.fire(order);`,
    title: "Circuit breakers",
    category: "Reliability",
    failureScenario:
      "A payment gateway goes down, and the application keeps sending it thousands of requests a minute anyway - each one timing out slowly and tying up resources that had nothing to do with the outage.",
    fix: "After enough consecutive failures, stop calling the failing dependency for a cooldown period and fail fast instead. Resources go to requests that can actually succeed, and the caller retries the dependency automatically once it's healthy again.",
  },
  {
    id: "replication",
    example: `const primary = new Pool({ host: "db-primary" });   // every write goes here
const replica = new Pool({ host: "db-replica" });   // reads that can tolerate lag

await primary.query("UPDATE accounts SET balance = $1 WHERE id = $2", [balance, id]);

// Bad: reading your own write from the replica - it may not have it yet
// Good: read-your-writes goes to the primary
const fresh = await primary.query("SELECT balance FROM accounts WHERE id = $1", [id]);`,
    title: "Database replication",
    category: "Reliability",
    failureScenario:
      "The single database instance the app depends on goes down for maintenance, or just crashes - and every read, not only writes, goes down with it, even though most of that traffic was only ever reading data.",
    fix: "Run replica copies of the data so reads can be served from a replica while the primary handles writes, and a replica can be promoted if the primary fails. Turns 'the database is down' from a full outage into a degraded, still-functioning system.",
  },
  {
    id: "distributed-locks",
    example: `// node-redis: acquire with an expiry, so a crashed holder can't block forever
const token = crypto.randomUUID();
const acquired = await redis.set("lock:invoice:42", token, { NX: true, PX: 30_000 });
if (!acquired) return;                        // someone else holds it

try {
  await generateInvoice(42);
} finally {
  // Good: release only if it's still ours (it may have expired and been re-taken)
  await redis.eval(
    'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) end',
    { keys: ["lock:invoice:42"], arguments: [token] }
  );
}`,
    title: "Distributed locks",
    category: "Reliability",
    failureScenario:
      "A nightly billing job runs on every instance behind the load balancer, because nothing stops two instances from both deciding it's their turn - customers get billed twice, not from a retry, but because two processes ran the same job at once.",
    fix: "Use a distributed lock (Redis-based, or a dedicated coordinator like ZooKeeper/etcd) so only one instance can hold the 'I'm running this job' lock at a time. A lock on a single Redis node is a reasonable start, not the final word - it has its own failure modes at real scale.",
  },
  {
    id: "bulkhead-pattern",
    example: `import pLimit from "p-limit";

// Good: a separate concurrency budget per dependency
const payments = pLimit(10);   // at most 10 calls in flight to payments
const reports = pLimit(2);     // a slow reports API can tie up 2 - never all of them

await payments(() => chargeCard(order));
await reports(() => buildReport(accountId));`,
    title: "Bulkhead pattern",
    category: "Reliability",
    failureScenario:
      "One slow third-party API (an email provider, say) exhausts the shared thread/connection pool every request uses. A completely unrelated feature - like login - starts failing too, because there are no threads left to serve it.",
    fix: "Give each dependency its own isolated pool of threads/connections instead of sharing one pool across everything. One slow or failing dependency then only starves its own slice, not the whole application - the same idea as a ship's watertight compartments: one holed section doesn't sink the vessel.",
  },
  {
    id: "backups-vs-replication",
    example: `# Replication copies a mistaken DELETE to the replica within milliseconds.
# A backup is a point in time you can restore to - from before the mistake.
pg_dump --format=custom --file=backup-2026-09-01.dump mydb

# A backup you've never restored is a hope, not a backup. Test it:
createdb mydb_restore_test
pg_restore --dbname=mydb_restore_test backup-2026-09-01.dump`,
    title: "Backups are not replication",
    category: "Reliability",
    failureScenario:
      "Someone runs a bad DELETE with no WHERE clause. Because the database is replicated for high availability, every replica applies the same delete within milliseconds - there's no 'other copy' to recover from, because replication faithfully copied the mistake too.",
    fix: "Replication protects against a server dying; only backups protect against corrupted or deleted data, because they capture point-in-time snapshots to roll back to. Run both, and actually test that a restore works - a backup nobody's restored is a guess, not a safety net.",
  },
  {
    id: "graceful-shutdown",
    example: `process.on("SIGTERM", () => {
  server.close(async () => {   // stop accepting; let in-flight requests finish
    await pool.end();          // then release database connections
    process.exit(0);
  });
  // Good: a deadline shorter than the orchestrator's kill timeout (30s in Kubernetes)
  setTimeout(() => process.exit(1), 25_000).unref();
});`,
    title: "Graceful shutdown",
    category: "Reliability",
    failureScenario:
      "A deploy sends SIGTERM. The process exits immediately, killing 40 in-flight requests mid-write and dropping the jobs its workers had already claimed but not finished. Users see connection resets during every routine deploy, and a few rows are left half-written. It looks like random flakiness; it's the shutdown path.",
    fix: "Handle SIGTERM instead of dying on it: stop accepting new work, fail the readiness probe so the load balancer stops routing to you, let in-flight requests finish within a bounded grace period, release claimed jobs back to the queue, close database pools, then exit. Bound it - if work hasn't drained in N seconds, exit anyway, or a stuck request keeps the old version alive forever.",
    whenToUse:
      "Anything that runs more than one instance or deploys without downtime, which in practice means anything on Kubernetes, ECS, or a rolling deploy of any kind. Doubly so for queue workers: a consumer that dies holding a claimed job either duplicates it or strands it, depending on your broker's redelivery rules.",
    references: [{ title: "Kubernetes: pod termination lifecycle", url: "https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination" }],
  },
];
