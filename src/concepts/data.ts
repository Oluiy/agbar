import type { Concept } from "./types.js";

/** Storing, modelling, and agreeing on data - including when systems disagree. */
export const DATA_CONCEPTS: Concept[] = [
  {
    id: "reconciliation",
    example: `-- Nightly: payments the provider says succeeded, that we never recorded
SELECT p.provider_payment_id, p.amount
FROM provider_payments p
LEFT JOIN orders o ON o.payment_id = p.provider_payment_id
WHERE p.status = 'succeeded' AND o.id IS NULL;
-- Every row is money taken with no order - alert on it, don't just log it`,
    title: "Reconciliation",
    category: "Data integrity",
    failureScenario:
      "A webhook never arrives, so your system marks a transaction as failed - but the bank's own records show it succeeded. Two systems now disagree about whether money moved.",
    fix: "Periodically compare your internal records against the provider's source of truth and correct mismatches. In any system that moves money, this isn't optional - webhooks get missed and networks fail regardless of how good your code is.",
  },
  {
    id: "cap-theorem",
    example: `// DynamoDB lets you choose per read. During trouble, either:
// answer fast, possibly with slightly stale data (availability)...
await docClient.get({ TableName: "carts", Key: { id } });

// ...or insist on the latest committed value (consistency)
await docClient.get({ TableName: "carts", Key: { id }, ConsistentRead: true });
// A shopping cart can tolerate stale; an account balance usually can't.`,
    title: "CAP theorem",
    category: "Distributed systems",
    failureScenario:
      "A network partition splits your database's replicas. One side has the latest write, the other doesn't, and a client can ask either one for a balance.",
    fix: "Not a fix - a forced tradeoff. During a partition you can keep every replica answering and risk stale data (Availability), or refuse to answer until they agree and risk downtime (Consistency); you cannot fully have both. Which one to pick follows from the cost of being wrong: a slightly stale social feed is fine, a wrong account balance is not.",
  },
  {
    id: "api-versioning",
    example: `app.use("/v1", v1Router);   // old clients keep working, unchanged
app.use("/v2", v2Router);   // breaking change: "name" split into firstName/lastName

// Adding an optional field is NOT breaking - no new version needed.
// Removing, renaming, or changing a field's type is.`,
    title: "API versioning",
    category: "API design",
    failureScenario:
      "A field's shape changes in a REST response to fix a bug for new clients. Every mobile app still on the old build - which can't force-update - breaks instantly, because it was never told the contract could change.",
    fix: "Version the API (URL path, header, or media type) so a breaking change ships as a new version existing clients keep ignoring, instead of changing the contract underneath everyone at once.",
  },
  {
    id: "communication-patterns",
    example: `// Synchronous: the caller waits - and fails if payments is down
const receipt = await fetch("http://payments/charge", {
  method: "POST", body: JSON.stringify(order), signal: AbortSignal.timeout(3000),
});

// Asynchronous: publish the fact and move on; consumers react when they can
await bus.publish("order.placed", { orderId: order.id });
// Use sync when you need the answer now; async when you just need it to happen.`,
    title: "Communication patterns",
    category: "System design",
    failureScenario:
      "A client polls an endpoint every second to check if a job is done, hammering the server with requests that return 'still processing' 99% of the time - or the reverse: a webhook-only integration silently drops events whenever the receiving service is down for a minute.",
    fix: "Match the pattern to the actual need: request/response for an immediate answer, pub/sub or webhooks with a retry/replay story for event-driven updates, long-polling or websockets over naive short-polling when near-real-time actually matters. The wrong pattern doesn't just cost performance - it changes what happens when the other side is temporarily unreachable.",
  },
  {
    id: "choosing-the-datastore",
    example: `Match the store to how you read the data:

  Relational (Postgres)  orders JOIN customers; transactions across tables
  Document (MongoDB)     one self-contained record per read (a product + its variants)
  Key-value (Redis)      get/set by key in under a millisecond: sessions, caches, counters
  Search (Elasticsearch) full-text and fuzzy search - alongside a primary store, not instead

Default to Postgres until an access pattern proves it wrong.`,
    title: "Choosing the right data store",
    category: "Data modeling",
    failureScenario:
      "A team models deeply nested, relationship-heavy data as JSON blobs in a NoSQL store to move fast early on, then spends months later bolting on the joins, transactions, and consistency guarantees a relational database gave them for free from day one.",
    fix: "Pick the storage model from the shape of the data and the guarantees actually needed, not from what's trendy: relational for structured data with real relationships and transactional needs, document/NoSQL for flexible or high-write-throughput data that doesn't need joins. Changing this decision later is a migration, not a config change.",
  },
  {
    id: "concurrency-control",
    example: `-- Optimistic locking: the update applies only if nobody changed the row since we read it
UPDATE accounts
SET balance = 50, version = version + 1
WHERE id = 7 AND version = 3;

-- 0 rows updated = someone else won the race.
-- Good: re-read and retry. Bad: overwrite their change blindly.`,
    title: "Optimistic vs. pessimistic concurrency control",
    category: "Data integrity",
    failureScenario:
      "Two users open the same invoice to edit it. Both save. Whoever saves second silently overwrites the first person's changes - no error, no merge, no warning. The classic 'lost update.'",
    fix: "Pessimistic locking (lock the row while editing) when conflicts are frequent or costly; optimistic locking (a version number that must match on save, reject if it doesn't) when conflicts are rare and holding a lock the whole time a form is open isn't worth it. Pick one on purpose - the default of neither is what causes lost updates.",
  },
  {
    id: "multi-tenancy",
    example: `-- Postgres row-level security: tenant isolation enforced by the database,
-- not by every query remembering its WHERE tenant_id = ...
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoices
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Per request, before querying:
SET app.tenant_id = '6f1c...';
-- Note: the table's owner bypasses RLS - connect the app as a different role.`,
    title: "Multi-tenancy data isolation",
    category: "Data integrity",
    failureScenario:
      "A shared table holds every customer's data with a tenant_id column, but one query forgets the WHERE tenant_id = ? filter. Customer A now sees Customer B's invoices - not a hack, just a missing clause.",
    fix: "Decide isolation deliberately: shared tables with tenant-scoped queries enforced by construction, not habit, for many small tenants; separate schemas for stronger isolation at moderate scale; a dedicated database per tenant when compliance demands it. Whichever model, make cross-tenant queries structurally hard, not just documented as a rule.",
  },
  {
    id: "transactional-outbox",
    example: `// Bad: two separate steps - a crash between them loses the event
await db.query("INSERT INTO orders ...");
await bus.publish("order.placed", { id });

// Good: the event is written in the SAME transaction as the data
await db.transaction(async (tx) => {
  await tx.query("INSERT INTO orders (id, total) VALUES ($1, $2)", [id, total]);
  await tx.query("INSERT INTO outbox (topic, payload) VALUES ($1, $2)", ["order.placed", JSON.stringify({ id })]);
});
// A separate relay publishes unsent outbox rows, then marks them sent.`,
    title: "The transactional outbox",
    category: "Data integrity",
    failureScenario:
      "An order handler writes the order to Postgres, then publishes an OrderPlaced event to Kafka. The database commit succeeds; the process dies before the publish. The order exists and nothing downstream knows - no email, no fulfilment, no invoice. Swap the order and you get the opposite bug: an event for an order that was rolled back.",
    fix: "Stop trying to write to two systems atomically, because you can't. Write the event into an `outbox` table in the same database transaction as the business data - one commit, both or neither. A separate relay (a poller, or change-data-capture like Debezium) reads that table and publishes to the broker, marking rows as sent. The event is now as durable as the order itself.",
    whenToUse:
      "Any time a state change in your database must produce a message other systems depend on. If losing the message is merely inconvenient, a direct publish with retries may be enough. If losing it means a customer is charged but never shipped, use an outbox. Note the relay delivers at-least-once, so consumers still need to be idempotent - the outbox fixes the write, not the read.",
    references: [
      { title: "Saga + Outbox: durable distributed transactions", url: "https://appscale.blog/en/blog/microservices-pattern-combo-saga-outbox-2026" },
      {
        title: "Microservices data patterns: saga, outbox, CQRS",
        url: "https://www.abstractalgorithms.dev/microservices-data-patterns-saga-outbox-cqrs-and-event-sourcing",
      },
    ],
  },
  {
    id: "saga-pattern",
    example: `// Each step has a compensating action. On failure, undo what's done, in reverse.
const steps = [
  { run: () => reserveStock(order), undo: () => releaseStock(order) },
  { run: () => chargeCard(order),   undo: () => refundCard(order) },
  { run: () => bookShipping(order), undo: () => cancelShipping(order) },
];

const completed = [];
try {
  for (const step of steps) { await step.run(); completed.push(step); }
} catch (err) {
  for (const step of completed.reverse()) await step.undo();
  throw err;
}`,
    title: "Sagas and compensating actions",
    category: "Data integrity",
    failureScenario:
      "Checkout spans four services: reserve inventory, charge the card, book shipping, send confirmation. Shipping fails. The card is already charged and the stock is already reserved - there's no distributed ROLLBACK to undo them, so the money stays taken and the item stays held.",
    fix: "Model the workflow as a saga: a sequence of local transactions, each with an explicit compensating action that semantically undoes it (refund the charge, release the reservation). When step three fails, run the compensations for steps two and one in reverse. Compensation is not rollback - a refund is a new transaction that leaves both entries in the ledger, which is usually what auditors want anyway.",
    whenToUse:
      "When one business operation must span multiple services or databases and cannot use a single transaction. Choreography (each service reacts to events) suits short, low-branching flows; an orchestrator or a durable workflow engine suits long-running or heavily conditional ones, and is far easier to debug. If the whole operation fits in one database, use a transaction and skip all of this.",
    references: [
      {
        title: "Event-driven architecture: saga patterns and outboxes",
        url: "https://thebackenddevelopers.substack.com/p/event-driven-architecture-saga-patterns",
      },
    ],
  },
  {
    id: "schema-migrations",
    example: `-- Bad: only works on a fresh database; an existing table is never changed
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT);

-- Good: numbered, committed, applied once each, in order
-- migrations/001_create_users.sql
CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);
-- migrations/002_add_users_name.sql
ALTER TABLE users ADD COLUMN name TEXT;`,
    title: "Schema migrations and rolling deploys",
    category: "Data modeling",
    failureScenario:
      "A migration renames `user_name` to `username` and deploys with the new code. For the ninety seconds of a rolling deploy, old pods are still running and querying a column that no longer exists - every request they serve 500s. The migration was correct; running it in the same step as the deploy was not.",
    fix: "Treat schema changes as versioned, ordered, reviewable files (Flyway, Liquibase, Alembic, Prisma Migrate) - never hand-run SQL. For anything destructive, expand and contract: add the new column, backfill it, make the code write both and read the new one, deploy, and only drop the old column in a later release once nothing references it. Every intermediate state must be one both the old and new code can survive.",
    whenToUse:
      "Every project with a database, from the first table. The expand/contract dance specifically matters when you run more than one instance or can't take downtime - single-instance side projects can afford the simpler path, but the habit is cheaper to build early than to retrofit during your first zero-downtime deploy.",
    references: [{ title: "Evolutionary database design (Fowler)", url: "https://martinfowler.com/articles/evodb.html" }],
  },
];
