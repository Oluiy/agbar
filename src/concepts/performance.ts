// agbar-ignore-file unbounded-list-query
// This file's examples show unbounded queries ON PURPOSE, as the "bad" half of a
// bad/good pair - text that teaches, not a query that runs.
import type { Concept } from "./types.js";

/** Speed and scale: what breaks between 200 rows and 2 million. */
export const PERFORMANCE_CONCEPTS: Concept[] = [
  {
    id: "database-indexing",
    example: `-- Bad: without an index, finding one user reads every row
SELECT * FROM users WHERE email = 'a@example.com';

-- Good: index the column you search by
CREATE INDEX idx_users_email ON users (email);

-- Check the database actually uses it: look for "Index Scan", not "Seq Scan"
EXPLAIN SELECT * FROM users WHERE email = 'a@example.com';`,
    title: "Database indexing",
    category: "Performance",
    failureScenario:
      "A query that returns in 50ms against 100 rows in development takes 5+ seconds in production against 10 million rows, because the database is scanning every row instead of jumping straight to the match.",
    fix: "Index the columns your real queries filter, join, or sort on. Before reaching for a bigger server, check the query's execution plan - most 'we need to scale' problems are actually 'we need an index' problems.",
  },
  {
    id: "caching",
    example: `// Cache-aside: check the cache, fall back to the source, then fill the cache
async function getUser(id) {
  const cached = await cache.get(\`user:\${id}\`);
  if (cached) return JSON.parse(cached);
  const user = await db.findUser(id);
  await cache.set(\`user:\${id}\`, JSON.stringify(user), { EX: 300 });  // expire in 5 min
  return user;
}`,
    practice: "agbar learn algorithms 03-lru-cache",
    title: "Caching",
    category: "Performance",
    failureScenario:
      "A dashboard gets opened by thousands of users a minute, and every single request hits Postgres directly for data that barely changes between requests.",
    fix: "Put an in-memory cache (Redis or similar) in front of the database for read-heavy, slow-changing data. Lower latency for users, less repeated work for the database.",
  },
  {
    id: "message-queues",
    example: `// BullMQ. Request path: enqueue the slow work and return immediately
const emails = new Queue("emails");
app.post("/signup", async (req, res) => {
  const user = await users.create(req.body);
  await emails.add("welcome", { userId: user.id });
  res.status(201).json(user);          // good: doesn't wait on the email provider
});

// A worker drains the queue at its own pace, and retries failed jobs
new Worker("emails", async (job) => sendWelcomeEmail(job.data.userId));`,
    title: "Message queues",
    category: "Scalability",
    failureScenario:
      "A signup endpoint creates the account, sends a welcome email, notifies an admin, and updates analytics - all inside the HTTP request. The user waits on a slow email provider to get a response that has nothing to do with their email.",
    fix: "Do the minimum synchronously, then push everything else onto a queue for a worker to process afterward. The response comes back immediately regardless of how slow the side effects are.",
  },
  {
    id: "statelessness",
    example: `// Bad: sessions live in this process only - a restart or a 2nd instance loses them
app.use(session({ secret }));                          // default MemoryStore

// Good: any instance can serve any request
app.use(session({ secret, store: new RedisStore({ client: redis }) }));`,
    title: "Statelessness",
    category: "Scalability",
    failureScenario:
      "Session data gets stored in the memory of the server that handled login. The load balancer routes the next request to a different instance, which has no idea who the user is - or that instance restarts and every logged-in user is suddenly logged out.",
    fix: "Keep servers stateless: store session/auth state in a shared store (Redis, a signed JWT) any instance can read, not in one process's memory. Any request can then be handled by any instance - the actual precondition for horizontal scaling.",
  },
  {
    id: "connection-pooling",
    example: `// Bad: a new connection per request - hits the DB's connection limit under load
app.get("/users", async (req, res) => {
  const client = new Client(); await client.connect(); /* ... */
});

// Good: one pool, created once, shared by every request
const pool = new Pool({ max: 10 });
app.get("/users", async (req, res) => res.json((await pool.query("SELECT ...")).rows));`,
    title: "Connection pooling",
    category: "Performance",
    failureScenario:
      "Traffic spikes and the app opens a new database connection per request. The database has a hard connection limit; once it's hit, every further request fails with 'too many connections' even though the database itself isn't overloaded.",
    fix: "Reuse a fixed pool of already-open connections instead of opening one per request. Size the pool to the database's actual limit, not to however many requests happen to arrive at once.",
    whenToUse:
      "Sizing is the whole decision, and more is not better: a pool larger than the database can serve just moves the queue from your app to the database, where it is harder to see. Java 21+ virtual threads make this sharper rather than softer - they make blocking cheap at the thread level, so a service can now have tens of thousands of threads all wanting a connection, but the pool is still the real limit. Keep the pool bounded and let threads wait on it. Watch for pinning too: a virtual thread that blocks inside a synchronized block holds its carrier thread, which is the one way this gets worse rather than better.",
  },
  {
    id: "pagination",
    example: `-- Bad: every row, however many there are
SELECT * FROM orders;

-- Good: a bounded page, continuing from the last id seen (cursor pagination)
SELECT * FROM orders WHERE id > $1 ORDER BY id LIMIT 50;`,
    title: "Pagination",
    category: "Performance",
    failureScenario:
      "An endpoint returns 'all users' with no limit. It works fine with 200 test rows, then the table grows to 2 million and the same request times out or runs the server out of memory serializing the whole result set.",
    fix: "Never return an unbounded list. Use cursor-based pagination (a stable pointer to 'next') for anything that changes while being paged through, offset-based only for small, mostly-static datasets where 'page 47' actually means something.",
  },
  {
    id: "n-plus-one-queries",
    example: `// Bad: 1 query for the orders + 1 per order = N+1 round trips
for (const order of orders) {
  order.customer = await db.findCustomer(order.customerId);
}

// Good: one query for all of them
const ids = orders.map((o) => o.customerId);
const customers = await db.query("SELECT * FROM customers WHERE id = ANY($1)", [ids]);`,
    title: "The N+1 query problem",
    category: "Performance",
    failureScenario:
      "An endpoint loads 50 orders, then loops over them fetching each order's customer separately - one query becomes 51. The page that felt instant with 5 test orders takes seconds in production.",
    fix: "Load related data in one batched query (a JOIN, or a single 'get all customers for these order IDs' call) instead of one query per row in a loop. Most ORMs cause this by default unless eager loading is requested explicitly.",
  },
  {
    id: "backpressure",
    example: `import { pipeline } from "node:stream/promises";

// Good: pipeline pauses reading whenever the upload can't keep up,
// instead of buffering a whole 5 GB file in memory
await pipeline(fs.createReadStream("export.csv"), toRows, uploadStream);

// At the edge: shed load instead of queuing forever
if (jobs.waiting > 1000) return res.status(503).set("Retry-After", "5").end();`,
    title: "Backpressure",
    category: "Scalability",
    failureScenario:
      "A fast producer (an API ingesting events) keeps accepting work faster than a slow consumer (a worker writing to a struggling database) can process it. The queue between them grows unbounded until the process runs out of memory.",
    fix: "Let the slow side push back: bound the queue size, block or reject new work once it's full, or have the consumer explicitly signal 'slow down' upstream. The alternative isn't 'no problem' - it's the same problem deferred until memory runs out.",
  },
  {
    id: "cache-warming",
    example: `// On startup, before taking traffic: load the hot keys
const hot = await db.query("SELECT id FROM products ORDER BY views DESC LIMIT 500");
for (const { id } of hot.rows) {
  await cache.set(\`product:\${id}\`, JSON.stringify(await loadProduct(id)), { EX: 3600 });
}
ready = true;   // good: only now does /health report ready - first users hit a warm cache`,
    title: "Cache warming",
    category: "Performance",
    failureScenario:
      "You deploy at 9am. Every cache is empty, and the first wave of real users each pay the full uncached cost - every query hits the database at once. The system that was comfortable at 3pm yesterday falls over ten seconds after a routine restart, and it looks like the deploy broke something when the code is identical.",
    fix: "Populate the cache before traffic arrives instead of letting users populate it for you. Three shapes: a warm-up step in the deploy pipeline that runs before traffic routes to the new instance, a scheduled job that refreshes hot keys on a cadence, and targeted preloading ahead of a known spike (a product going on sale, an article about to be published). Batch the warm-up and add jitter, or the warming job becomes its own stampede.",
    whenToUse:
      "Worth it when a cold cache is genuinely dangerous: the backing store can't absorb full traffic unaided, restarts/deploys are frequent, or you get predictable spikes you can prepare for. Skip it when the cache fills naturally within seconds under light load, or when you can't identify which keys are hot - warming the wrong keys is just work that evicts the right ones.",
    references: [
      { title: "Cache warming strategies", url: "https://oneuptime.com/blog/post/2026-01-30-cache-warming-strategies/view" },
      { title: "Avoiding the cold start", url: "https://adhdecode.com/distributed-systems/distributed-caching/cache-warming-strategies/" },
    ],
  },
  {
    id: "cache-stampede",
    example: `// Single-flight: concurrent misses for the same key share ONE load
const inFlight = new Map();

async function getProduct(id) {
  const cached = await cache.get(\`product:\${id}\`);
  if (cached) return JSON.parse(cached);

  if (!inFlight.has(id)) {
    const load = loadProduct(id).finally(() => inFlight.delete(id));
    inFlight.set(id, load);
  }
  const product = await inFlight.get(id);   // good: 1,000 misses -> 1 database query
  await cache.set(\`product:\${id}\`, JSON.stringify(product), { EX: 300 });
  return product;
}`,
    title: "Cache stampede (thundering herd)",
    category: "Performance",
    failureScenario:
      "One hot key expires. In the millisecond before anything repopulates it, 5,000 in-flight requests all miss, all decide to regenerate it, and all hit the database with the same expensive query at once. The cache was protecting the database right up until the instant it stopped.",
    fix: "Two mechanisms, and they solve different halves. **Request coalescing**: when 100 requests miss the same key, exactly one recomputes while the other 99 wait on that result. **TTL jitter**: never expire keys on a round number - spread expiries over a window so a batch of keys written together doesn't expire together. Jitter is a two-line change that removes an entire class of incident.",
    whenToUse:
      "Any cached value that is both expensive to compute and shared across many concurrent readers. A per-user key that only one request wants is not a stampede risk; a homepage feed, a pricing table, or a permissions lookup absolutely is. If you cache anything with a fixed TTL set at write time in bulk, add jitter now rather than after the first incident.",
    references: [
      { title: "Cache stampede prevention", url: "https://oneuptime.com/blog/post/2026-01-30-cache-stampede-prevention/view" },
      { title: "Caching strategies to prevent the thundering herd", url: "https://gsavitha.in/blog/caching-strategies/" },
    ],
  },
];
