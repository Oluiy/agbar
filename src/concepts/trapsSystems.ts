import type { Concept } from "./types.js";

/**
 * Small, easily-overlooked traps in the systems around the code: HTTP, SQL,
 * concurrency, input handling, files. Each is one line to get wrong and one line
 * to get right - which is exactly why it's worth knowing by name.
 */
export const SYSTEM_TRAP_CONCEPTS: Concept[] = [
  {
    id: "http-method-semantics",
    title: "PUT and DELETE must be idempotent",
    category: "HTTP & APIs",
    failureScenario:
      "Sign-up is PUT /users. HTTP defines PUT as idempotent, so a proxy or client library retries it automatically after a dropped connection - the user was already created, so they get two welcome emails and a second charge.",
    fix: 'Use POST for anything that creates something or has a side effect that mustn\'t repeat, and give it an idempotency key. PUT means "set this resource to exactly this" - safe to repeat.',
    example: `// Good: repeating it changes nothing
app.put("/users/:id/email", setEmail);
// Good: creates something - POST, with an Idempotency-Key header
app.post("/payments", chargeOnce);`,
    practice: "buildquick learn traps 04-api-and-file-traps",
  },
  {
    id: "socket-exhaustion",
    title: "Socket exhaustion from short-lived HTTP clients",
    category: "HTTP & APIs",
    failureScenario:
      "Each request creates and disposes a new HttpClient. Every closed connection sits in TIME_WAIT (about 60 seconds on Linux, 240 by default on Windows), so under load the machine runs out of outbound ports and calls fail with socket errors.",
    fix: "Create HTTP (and database) clients once and reuse them for the life of the app: a shared instance, a Session, or IHttpClientFactory in .NET.",
    example: `In C#:
  using var client = new HttpClient();   // bad: per request
  services.AddHttpClient();              // good: pooled, reused, DNS-aware
In Python:
  requests.get(url)                      # new connection each time
  session = requests.Session()           # good: reuse one session`,
  },
  {
    id: "dns-caching",
    title: "DNS cached forever",
    category: "HTTP & APIs",
    failureScenario:
      "A downstream service fails over to a new IP. The long-lived connection pool (or a JVM caching lookups indefinitely) keeps sending traffic to the old address, and requests fail until the app is restarted.",
    fix: "Bound how long a resolved address or pooled connection lives: networkaddress.cache.ttl in the JVM, SocketsHttpHandler.PooledConnectionLifetime in .NET.",
    example: `In .NET:
  new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(2) }
In Java (java.security):
  networkaddress.cache.ttl=60`,
  },
  {
    id: "spreading-built-in-objects",
    title: "Spreading Headers, FormData or URLSearchParams",
    category: "HTTP & APIs",
    failureScenario:
      "A proxy copies the incoming request's headers with { ...headers }. Headers keeps its data in internal slots, not ordinary properties, so the copy is {} - the Authorization header is dropped and the upstream call fails with 401, with no error at the copy.",
    fix: "Convert explicitly through the object's iterator (Object.fromEntries(headers.entries())), or pass the object itself.",
    example: `const headers = new Headers({ authorization: "Bearer abc" });
({ ...headers });                          // bad: {}
Object.fromEntries(headers.entries());     // good: { authorization: "Bearer abc" }`,
    practice: "buildquick learn traps 04-api-and-file-traps",
  },
  {
    id: "sql-null-logic",
    title: "SQL NULL and three-valued logic",
    category: "SQL & Databases",
    failureScenario:
      "WHERE status != 'INACTIVE' is meant to list every user who isn't inactive. Rows where status is NULL vanish too, because NULL != 'INACTIVE' is UNKNOWN, not TRUE - so unverified users silently disappear from reports and emails.",
    fix: "Handle NULL explicitly (OR status IS NULL, or IS DISTINCT FROM in Postgres), or make the column NOT NULL with a default.",
    example: `-- Bad: silently drops rows where status IS NULL
SELECT * FROM users WHERE status != 'INACTIVE';
-- Good
SELECT * FROM users WHERE status != 'INACTIVE' OR status IS NULL;
-- Good (Postgres): NULL-safe comparison
SELECT * FROM users WHERE status IS DISTINCT FROM 'INACTIVE';`,
  },
  {
    id: "collation-uniqueness",
    title: "Collation and case-insensitive uniqueness",
    category: "SQL & Databases",
    failureScenario:
      "Emails are UNIQUE in Postgres, which compares case-sensitively by default, so Test@example.com and test@example.com become two accounts. Move the same schema to MySQL (case-insensitive by default) and the opposite surprise happens.",
    fix: "Normalize before storing (lowercase emails), or enforce uniqueness on the normalized form.",
    example: `-- Postgres: unique regardless of case
CREATE UNIQUE INDEX users_email_lower ON users (LOWER(email));`,
  },
  {
    id: "deadlock-lock-order",
    title: "Deadlocks from inconsistent lock order",
    category: "SQL & Databases",
    failureScenario:
      "Transfer A locks account 1 then 2; transfer B locks 2 then 1 at the same moment. Each waits for the other forever, and the database kills one - a failed payment that only happens under load.",
    fix: "Always acquire locks (rows, mutexes) in one global order - for example by ascending id - everywhere in the codebase.",
    example: `// Good: lock in a consistent order, whichever way the money moves
const [first, second] = [fromId, toId].sort((a, b) => a - b);
await tx.query("SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE", [first]);
await tx.query("SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE", [second]);`,
  },
  {
    id: "captive-dependencies",
    title: "Captive dependencies in dependency injection",
    category: "Runtime & Concurrency",
    failureScenario:
      "A singleton cache takes a scoped DbContext in its constructor. That one DbContext is now shared by every request for the life of the process: concurrent requests use it at once, and one user's unsaved changes leak into another's.",
    fix: "Never inject a shorter-lived service into a longer-lived one. A singleton that needs scoped services creates a scope when it needs one (IServiceScopeFactory in .NET).",
    example: `In C#:
  public CacheWarmer(AppDbContext db) { }               // bad: singleton holds a scoped service
  public CacheWarmer(IServiceScopeFactory scopes) { }   // good
  using var scope = scopes.CreateScope();
  var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();`,
  },
  {
    id: "disposable-leaks",
    title: "Transient disposables resolved from the root container",
    category: "Runtime & Concurrency",
    failureScenario:
      "Code resolves a transient IDisposable straight from the root service provider. The container keeps a reference so it can dispose it at shutdown - which is never - so every instance stays in memory and the process slowly runs out.",
    fix: "Resolve disposables inside a scope that gets disposed, or create them yourself in a using block.",
    example: `In C#:
  var x = app.Services.GetRequiredService<ReportBuilder>();   // bad: held until shutdown
  using var scope = app.Services.CreateScope();                // good
  var y = scope.ServiceProvider.GetRequiredService<ReportBuilder>();`,
  },
  {
    id: "non-atomic-updates",
    title: "count++ is not atomic",
    category: "Runtime & Concurrency",
    failureScenario:
      "Two threads increment the same counter. count++ is read, add, write: both read 41, both write 42, and one increment is lost. Inventory, rate limits and metrics drift under load. The same happens in a database with read-then-update code.",
    fix: "Use atomic operations (Interlocked, AtomicInteger, sync/atomic) or a lock - and in SQL, update in one statement: SET stock = stock - 1 WHERE stock > 0.",
    example: `-- Bad: read, then write back - two requests both see 5
SELECT stock FROM items WHERE id = 7;
-- Good: one atomic statement, and it can't go negative
UPDATE items SET stock = stock - 1 WHERE id = 7 AND stock > 0;`,
  },
  {
    id: "sync-over-async",
    title: "Blocking on async code (sync-over-async)",
    category: "Runtime & Concurrency",
    failureScenario:
      "A handler blocks the thread (or the loop) that was supposed to stay free. In .NET, GetUserAsync().Result holds a thread-pool thread until the work it waits on gets a thread of its own - under load every thread is blocked waiting. In Python and Node there is only one event loop, so a single blocking call inside an async handler stops every other request too. The tell is the same everywhere: latency climbs while CPU stays low, because nothing is working - everything is waiting.",
    fix: "Async all the way up, and never call a blocking library from an async function. Use the async client (httpx over requests, asyncpg over psycopg2, fs/promises over fs.readFileSync), and push work that has no async version off the loop - asyncio.to_thread, or a worker thread. CPU-bound work needs a process, not a thread: Python threads share one interpreter lock.",
    whenToUse:
      "The offload rule cuts both ways - moving a fast call to a thread pool costs more than it saves. Offload what blocks for milliseconds or more (file reads, image work, hashing), not every function that lacks an await.",
    examples: [
      {
        language: "Python (FastAPI)",
        code: `@app.get("/users/{id}")
async def get_user(id: int):
    r = requests.get(url)             # bad: stalls the loop for every request
    r = await client.get(url)         # good: httpx.AsyncClient
    rows = cursor.execute(q)          # bad: psycopg2 blocks
    rows = await conn.fetch(q)        # good: asyncpg
    thumb = await asyncio.to_thread(resize, img)   # no async version? offload it`,
      },
      {
        language: "Node (Express, Fastify, NestJS)",
        code: `// Bad: both freeze the only event loop, for every request
const report = readFileSync(path);
const key = pbkdf2Sync(pw, salt, 600000, 32, "sha256");

// Good: async variants hand the work off and let the loop keep serving
const report2 = await readFile(path);
const key2 = await promisify(pbkdf2)(pw, salt, 600000, 32, "sha256");`,
      },
      {
        language: "C# (ASP.NET Core)",
        code: `var user = GetUserAsync(id).Result;   // bad: blocks a thread-pool thread
var user = await GetUserAsync(id);    // good
// .Wait() and .GetAwaiter().GetResult() are the same mistake.`,
      },
    ],
  },
  {
    id: "mass-assignment",
    title: "Mass assignment (over-posting)",
    category: "Input Security",
    failureScenario:
      'An update endpoint binds the request body straight onto the User entity. An attacker adds "isAdmin": true to the JSON, and the ORM saves it - they just made themselves an admin.',
    fix: "Bind requests to a DTO that contains only the fields the client may change, then copy those fields onto the entity.",
    example: `// Bad: every field the client sends is saved
await db.users.update(id, req.body);
// Good: only what the client may change
const { name, bio } = req.body;
await db.users.update(id, { name, bio });`,
  },
  {
    id: "timing-attacks",
    title: "Comparing secrets in constant time",
    category: "Input Security",
    failureScenario:
      "An API checks if (token === SECRET). String comparison stops at the first different character, so a longer response time means more leading characters matched - measured over many requests, an attacker recovers the secret character by character.",
    fix: "Compare secrets, signatures and tokens with a constant-time function: crypto.timingSafeEqual (Node), hmac.compare_digest (Python), CryptographicOperations.FixedTimeEquals (.NET).",
    example: `import { timingSafeEqual } from "node:crypto";
const a = Buffer.from(token);
const b = Buffer.from(SECRET);
// Good: same time whatever matches (lengths must be equal first)
const ok = a.length === b.length && timingSafeEqual(a, b);`,
  },
  {
    id: "ssrf",
    title: "Server-side request forgery (SSRF)",
    category: "Input Security",
    failureScenario:
      '"Import avatar from URL" fetches whatever the user sends. They send http://169.254.169.254/latest/meta-data/ and the server returns its own cloud credentials - or http://localhost:8080/admin.',
    fix: "Resolve the hostname, reject private, loopback and link-local addresses (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, ::1), don't follow redirects blindly, and prefer an allow-list of hosts.",
    example: `import { lookup } from "node:dns/promises";
const { address } = await lookup(new URL(userUrl).hostname);
const privateRange = /^(127\\.|10\\.|192\\.168\\.|169\\.254\\.|172\\.(1[6-9]|2\\d|3[01])\\.|::1$)/;
if (privateRange.test(address)) throw new Error("URL points at an internal address");`,
  },
  {
    id: "path-traversal",
    title: "Path traversal via file names",
    category: "Input Security",
    failureScenario:
      "Uploads are saved to path.join(uploadDir, file.originalname). A client names the file ../../etc/cron.d/job, and the server writes it outside the upload folder - overwriting system files or planting a script.",
    fix: "Don't use client-supplied names as paths: generate a name (a UUID), or at least take the base name, reject '.' and '..', and check the resolved path is still inside the folder.",
    example: `import path from "node:path";
path.join("/var/uploads", "../../etc/passwd");   // "/etc/passwd" - escaped
// Good: we choose the name
const safe = path.join("/var/uploads", \`\${crypto.randomUUID()}.png\`);`,
    practice: "buildquick learn traps 04-api-and-file-traps",
  },
  {
    id: "atomic-file-writes",
    title: "Atomic file writes",
    category: "Files & OS",
    failureScenario:
      'A state file is rewritten with open("state.json", "w"). Opening for write empties it immediately; the process is killed halfway through writing, and on restart the file is empty or truncated JSON - the app can\'t start.',
    fix: "Write to a temporary file in the same folder, flush it to disk, then rename it over the original. A rename is atomic: readers see the old file or the new one, never half of one.",
    example: `import { writeFileSync, renameSync } from "node:fs";
const tmp = "state.json.tmp";
writeFileSync(tmp, JSON.stringify(state));   // for full durability, fsync before renaming
renameSync(tmp, "state.json");               // atomic on the same filesystem`,
    practice: "buildquick learn traps 04-api-and-file-traps",
  },
  {
    id: "filesystem-case-sensitivity",
    title: "Filesystem case sensitivity",
    category: "Files & OS",
    failureScenario:
      'import { User } from "./user" works on macOS and Windows, whose default filesystems ignore case, even though the file is User.ts. The Linux CI or Docker build - case-sensitive - fails with "module not found".',
    fix: "Match file names exactly, enable the linter/compiler checks for it (TypeScript: forceConsistentCasingInFileNames), and build in a Linux container before merging.",
    example: `// Bad: works on a Mac, breaks on Linux (the file is UserModel.ts)
import { UserModel } from "./userModel";
// Good: exact case
import { UserModel as Model } from "./UserModel";`,
  },
  {
    id: "file-descriptor-leaks",
    title: "Leaking file handles and sockets",
    category: "Files & OS",
    failureScenario:
      'Files and connections are opened and left for the garbage collector to close. The GC runs on memory pressure, not handle pressure, so the process hits its open-file limit (often 1024 on Linux) and every new file or socket fails with "too many open files".',
    fix: "Close every OS handle deterministically: using (C#), with (Python), try-with-resources (Java), try/finally or explicit close in JavaScript.",
    example: `import { open } from "node:fs/promises";
const file = await open("big.log");
try {
  for await (const line of file.readLines()) handle(line);
} finally {
  await file.close();   // good: closed even if handle() throws
}`,
  },
  {
    id: "schema-evolution",
    title: "Backward-compatible API and message schemas",
    category: "Serialization",
    failureScenario:
      "A backend renames a JSON field and makes a new one required. Deploys aren't instant: the old mobile app, and the service that hasn't been redeployed yet, can't parse the new messages and start failing.",
    fix: "Change contracts additively: add new optional fields, keep old ones until every consumer has moved, and never reuse a field name or protobuf field number for a different meaning.",
    example: `// v1 of the message
const v1 = { fullName: "Ada Lovelace" };
// Bad: v2 renames the field - every old client reading fullName breaks at once
const badV2 = { name: "Ada Lovelace" };
// Good: v2 adds the new field and keeps the old one until every consumer moved
const goodV2 = { name: "Ada Lovelace", fullName: "Ada Lovelace" };`,
  },
  {
    id: "cancellation-propagation",
    title: "Cancellation (work nobody is waiting for)",
    category: "Runtime & Concurrency",
    failureScenario:
      "A client gives up after 3 seconds and disconnects. The server never finds out: the database query runs to completion, the three upstream calls it fans out to still happen, and the result is written to a socket that closed long ago. Under load this is how a service collapses - every timed-out request leaves its work running, so the queue grows faster than it drains even though no one is waiting for any of it.",
    fix: "Pass a cancellation signal down the whole call chain and have every blocking step honour it - Go's context.Context, an AbortSignal in Node, a CancellationToken in .NET, a cancelled Tokio task in Rust. A goroutine or task that cannot be told to stop is a leak with a long fuse. Check for cancellation before expensive steps as well as during them, and treat it as neither success nor failure: nothing went wrong, the answer simply stopped being wanted.",
    whenToUse:
      "Not everything should be cancellable. Work that has already changed state - a payment taken, a row written - usually has to finish or be undone deliberately, so cancel the read path and the fan-out freely, and give writes a transaction or an idempotency key instead.",
    examples: [
      {
        language: "Go",
        code: `// Bad: the goroutine outlives the request and blocks forever on send
go func() { results <- expensive() }()

// Good: it stops when the request's context is cancelled
go func() {
    select {
    case results <- expensive():
    case <-ctx.Done():   // client gone; nothing is reading results
    }
}()`,
      },
      {
        language: "Node",
        code: `// Bad: the upstream call runs on after the client disconnects
const data = await fetch(url);

// Good: the client going away aborts the work it caused
const live = await fetch(url, { signal: AbortSignal.any([req.signal, AbortSignal.timeout(2000)]) });`,
      },
    ],
  },
];
