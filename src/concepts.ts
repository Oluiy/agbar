/**
 * Reliability/scale concepts most tutorials skip - the gap between "an API that
 * works" and "a system that survives production." Unlike explain.ts's Decisions,
 * these aren't tied to code buildquick actually generated (it doesn't scaffold a
 * message queue or a circuit breaker) - they're static, always the same list, and
 * rendered into LEVELING-UP.md honestly framed as "not here yet, but you'll need
 * it eventually," not as an explanation of this specific project.
 */

export interface Concept {
  id: string;
  title: string;
  category: string;
  /** The concrete way this bites a system that doesn't have it. */
  failureScenario: string;
  /** The mechanism that prevents it. */
  fix: string;
}

export const BACKEND_CONCEPTS: Concept[] = [
  {
    id: "idempotency-keys",
    title: "Idempotency keys",
    category: "Reliability",
    failureScenario:
      "A user's withdrawal request times out on the client, so they click the button again - maybe a third time. Without protection, your system processes all three as separate withdrawals.",
    fix:
      "Attach a unique idempotency key to the request. If the same key arrives again, return the original result instead of processing it a second time. Standard in any payment API, because retries and timeouts are guaranteed to happen, not just possible.",
  },
  {
    id: "database-indexing",
    title: "Database indexing",
    category: "Performance",
    failureScenario:
      "A query that returns in 50ms against 100 rows in development takes 5+ seconds in production against 10 million rows, because the database is scanning every row instead of jumping straight to the match.",
    fix:
      "Index the columns your real queries filter, join, or sort on. Before reaching for a bigger server, check the query's execution plan - most 'we need to scale' problems are actually 'we need an index' problems.",
  },
  {
    id: "caching",
    title: "Caching",
    category: "Performance",
    failureScenario:
      "A dashboard gets opened by thousands of users a minute, and every single request hits Postgres directly for data that barely changes between requests.",
    fix:
      "Put an in-memory cache (Redis or similar) in front of the database for read-heavy, slow-changing data. Lower latency for users, less repeated work for the database.",
  },
  {
    id: "message-queues",
    title: "Message queues",
    category: "Scalability",
    failureScenario:
      "A signup endpoint creates the account, sends a welcome email, notifies an admin, and updates analytics - all inside the HTTP request. The user waits on a slow email provider to get a response that has nothing to do with their email.",
    fix:
      "Do the minimum synchronously, then push everything else onto a queue for a worker to process afterward. The response comes back immediately regardless of how slow the side effects are.",
  },
  {
    id: "retry-mechanisms",
    title: "Retry mechanisms (exponential backoff)",
    category: "Reliability",
    failureScenario:
      "A downstream provider blips for two seconds. With no retry, that two-second blip becomes a permanent failure the user actually sees.",
    fix:
      "Retry transient failures automatically, waiting longer between each attempt (exponential backoff) instead of hammering an already-struggling service harder. Give up and surface the failure only after a bounded number of tries.",
  },
  {
    id: "dead-letter-queues",
    title: "Dead letter queues",
    category: "Reliability",
    failureScenario:
      "A background job keeps failing past its retry limit, and a naive queue just drops it. The failure is invisible until a customer complains that something never happened.",
    fix:
      "Route jobs that exhaust their retries into a separate dead letter queue instead of discarding them, so someone can inspect what actually went wrong later, instead of losing the request entirely.",
  },
  {
    id: "circuit-breakers",
    title: "Circuit breakers",
    category: "Reliability",
    failureScenario:
      "A payment gateway goes down, and the application keeps sending it thousands of requests a minute anyway - each one timing out slowly and tying up resources that had nothing to do with the outage.",
    fix:
      "After enough consecutive failures, stop calling the failing dependency for a cooldown period and fail fast instead. Resources go to requests that can actually succeed, and the caller retries the dependency automatically once it's healthy again.",
  },
  {
    id: "reconciliation",
    title: "Reconciliation",
    category: "Data integrity",
    failureScenario:
      "A webhook never arrives, so your system marks a transaction as failed - but the bank's own records show it succeeded. Two systems now disagree about whether money moved.",
    fix:
      "Periodically compare your internal records against the provider's source of truth and correct mismatches. In any system that moves money, this isn't optional - webhooks get missed and networks fail regardless of how good your code is.",
  },
  {
    id: "cap-theorem",
    title: "CAP theorem",
    category: "Distributed systems",
    failureScenario:
      "A network partition splits your database's replicas. One side has the latest write, the other doesn't, and a client can ask either one for a balance.",
    fix:
      "Not a fix - a forced tradeoff. During a partition you can keep every replica answering and risk stale data (Availability), or refuse to answer until they agree and risk downtime (Consistency); you cannot fully have both. Which one to pick follows from the cost of being wrong: a slightly stale social feed is fine, a wrong account balance is not.",
  },
  {
    id: "statelessness",
    title: "Statelessness",
    category: "Scalability",
    failureScenario:
      "Session data gets stored in the memory of the server that handled login. The load balancer routes the next request to a different instance, which has no idea who the user is - or that instance restarts and every logged-in user is suddenly logged out.",
    fix:
      "Keep servers stateless: store session/auth state in a shared store (Redis, a signed JWT) any instance can read, not in one process's memory. Any request can then be handled by any instance - the actual precondition for horizontal scaling.",
  },
  {
    id: "connection-pooling",
    title: "Connection pooling",
    category: "Performance",
    failureScenario:
      "Traffic spikes and the app opens a new database connection per request. The database has a hard connection limit; once it's hit, every further request fails with 'too many connections' even though the database itself isn't overloaded.",
    fix:
      "Reuse a fixed pool of already-open connections instead of opening one per request. Size the pool to the database's actual limit, not to however many requests happen to arrive at once.",
  },
  {
    id: "security-by-design",
    title: "Security by design",
    category: "Security",
    failureScenario:
      "An endpoint checks that a request is authenticated but not that the authenticated user actually owns the resource being requested - so user A can read or edit user B's data just by changing an ID in the URL.",
    fix:
      "Treat authentication (who is this?) and authorization (are they allowed to do this?) as two separate, mandatory checks on every request. Encrypt sensitive data at rest and in transit, and check new endpoints against the OWASP Top 10 before shipping, not after an audit finds it.",
  },
  {
    id: "observability",
    title: "Observability",
    category: "Operations",
    failureScenario:
      "A service starts failing in production. The only available signal is 'users are complaining' - no structured logs, no metrics, no way to trace one failing request through the five services it touched.",
    fix:
      "Emit structured logs, metrics, and distributed traces as the system runs, not just error messages when it crashes. The goal is answering 'what happened, where, and why' from data already being collected, instead of reproducing the bug live.",
  },
  {
    id: "api-versioning",
    title: "API versioning",
    category: "API design",
    failureScenario:
      "A field's shape changes in a REST response to fix a bug for new clients. Every mobile app still on the old build - which can't force-update - breaks instantly, because it was never told the contract could change.",
    fix:
      "Version the API (URL path, header, or media type) so a breaking change ships as a new version existing clients keep ignoring, instead of changing the contract underneath everyone at once.",
  },
  {
    id: "communication-patterns",
    title: "Communication patterns",
    category: "System design",
    failureScenario:
      "A client polls an endpoint every second to check if a job is done, hammering the server with requests that return 'still processing' 99% of the time - or the reverse: a webhook-only integration silently drops events whenever the receiving service is down for a minute.",
    fix:
      "Match the pattern to the actual need: request/response for an immediate answer, pub/sub or webhooks with a retry/replay story for event-driven updates, long-polling or websockets over naive short-polling when near-real-time actually matters. The wrong pattern doesn't just cost performance - it changes what happens when the other side is temporarily unreachable.",
  },
  {
    id: "choosing-the-datastore",
    title: "Choosing the right data store",
    category: "Data modeling",
    failureScenario:
      "A team models deeply nested, relationship-heavy data as JSON blobs in a NoSQL store to move fast early on, then spends months later bolting on the joins, transactions, and consistency guarantees a relational database gave them for free from day one.",
    fix:
      "Pick the storage model from the shape of the data and the guarantees actually needed, not from what's trendy: relational for structured data with real relationships and transactional needs, document/NoSQL for flexible or high-write-throughput data that doesn't need joins. Changing this decision later is a migration, not a config change.",
  },
  {
    id: "rate-limiting",
    title: "Rate limiting",
    category: "Security",
    failureScenario:
      "A login endpoint has no limit on failed attempts, so a bot can try thousands of password guesses a minute - or one misbehaving client script accidentally loops a request and takes the endpoint down for every other user.",
    fix:
      "Cap how many requests a client (by IP, API key, or user) can make in a given window, and return 429 once they exceed it. Protects against both attackers and your own client bugs, for a lot less than the cost of the outage it prevents.",
  },
  {
    id: "replication",
    title: "Database replication",
    category: "Reliability",
    failureScenario:
      "The single database instance the app depends on goes down for maintenance, or just crashes - and every read, not only writes, goes down with it, even though most of that traffic was only ever reading data.",
    fix:
      "Run replica copies of the data so reads can be served from a replica while the primary handles writes, and a replica can be promoted if the primary fails. Turns 'the database is down' from a full outage into a degraded, still-functioning system.",
  },
  {
    id: "secrets-management",
    title: "Secrets management",
    category: "Security",
    failureScenario:
      "A database password or API key gets hardcoded into a config file that's committed to git - now it's in the repo's history forever, visible to anyone with clone access, long after anyone remembers it's there.",
    fix:
      "Keep secrets out of source control entirely: environment variables sourced from a secrets manager or vault, never hardcoded, never committed, rotated when someone with access leaves. A `.env` file still needs to be in `.gitignore`, not just 'not committed yet.'",
  },
  {
    id: "pagination",
    title: "Pagination",
    category: "Performance",
    failureScenario:
      "An endpoint returns 'all users' with no limit. It works fine with 200 test rows, then the table grows to 2 million and the same request times out or runs the server out of memory serializing the whole result set.",
    fix:
      "Never return an unbounded list. Use cursor-based pagination (a stable pointer to 'next') for anything that changes while being paged through, offset-based only for small, mostly-static datasets where 'page 47' actually means something.",
  },
  {
    id: "n-plus-one-queries",
    title: "The N+1 query problem",
    category: "Performance",
    failureScenario:
      "An endpoint loads 50 orders, then loops over them fetching each order's customer separately - one query becomes 51. The page that felt instant with 5 test orders takes seconds in production.",
    fix:
      "Load related data in one batched query (a JOIN, or a single 'get all customers for these order IDs' call) instead of one query per row in a loop. Most ORMs cause this by default unless eager loading is requested explicitly.",
  },
  {
    id: "distributed-locks",
    title: "Distributed locks",
    category: "Reliability",
    failureScenario:
      "A nightly billing job runs on every instance behind the load balancer, because nothing stops two instances from both deciding it's their turn - customers get billed twice, not from a retry, but because two processes ran the same job at once.",
    fix:
      "Use a distributed lock (Redis-based, or a dedicated coordinator like ZooKeeper/etcd) so only one instance can hold the 'I'm running this job' lock at a time. A lock on a single Redis node is a reasonable start, not the final word - it has its own failure modes at real scale.",
  },
  {
    id: "concurrency-control",
    title: "Optimistic vs. pessimistic concurrency control",
    category: "Data integrity",
    failureScenario:
      "Two users open the same invoice to edit it. Both save. Whoever saves second silently overwrites the first person's changes - no error, no merge, no warning. The classic 'lost update.'",
    fix:
      "Pessimistic locking (lock the row while editing) when conflicts are frequent or costly; optimistic locking (a version number that must match on save, reject if it doesn't) when conflicts are rare and holding a lock the whole time a form is open isn't worth it. Pick one on purpose - the default of neither is what causes lost updates.",
  },
  {
    id: "backpressure",
    title: "Backpressure",
    category: "Scalability",
    failureScenario:
      "A fast producer (an API ingesting events) keeps accepting work faster than a slow consumer (a worker writing to a struggling database) can process it. The queue between them grows unbounded until the process runs out of memory.",
    fix:
      "Let the slow side push back: bound the queue size, block or reject new work once it's full, or have the consumer explicitly signal 'slow down' upstream. The alternative isn't 'no problem' - it's the same problem deferred until memory runs out.",
  },
  {
    id: "bulkhead-pattern",
    title: "Bulkhead pattern",
    category: "Reliability",
    failureScenario:
      "One slow third-party API (an email provider, say) exhausts the shared thread/connection pool every request uses. A completely unrelated feature - like login - starts failing too, because there are no threads left to serve it.",
    fix:
      "Give each dependency its own isolated pool of threads/connections instead of sharing one pool across everything. One slow or failing dependency then only starves its own slice, not the whole application - the same idea as a ship's watertight compartments: one holed section doesn't sink the vessel.",
  },
  {
    id: "backups-vs-replication",
    title: "Backups are not replication",
    category: "Reliability",
    failureScenario:
      "Someone runs a bad DELETE with no WHERE clause. Because the database is replicated for high availability, every replica applies the same delete within milliseconds - there's no 'other copy' to recover from, because replication faithfully copied the mistake too.",
    fix:
      "Replication protects against a server dying; only backups protect against corrupted or deleted data, because they capture point-in-time snapshots to roll back to. Run both, and actually test that a restore works - a backup nobody's restored is a guess, not a safety net.",
  },
  {
    id: "multi-tenancy",
    title: "Multi-tenancy data isolation",
    category: "Data integrity",
    failureScenario:
      "A shared table holds every customer's data with a tenant_id column, but one query forgets the WHERE tenant_id = ? filter. Customer A now sees Customer B's invoices - not a hack, just a missing clause.",
    fix:
      "Decide isolation deliberately: shared tables with tenant-scoped queries enforced by construction, not habit, for many small tenants; separate schemas for stronger isolation at moderate scale; a dedicated database per tenant when compliance demands it. Whichever model, make cross-tenant queries structurally hard, not just documented as a rule.",
  },
];
