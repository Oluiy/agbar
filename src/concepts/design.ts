import type { Concept } from "./types.js";

/** Structural principles: whether a person can still change this code in six months. */
export const DESIGN_CONCEPTS: Concept[] = [
  {
    id: "dependency-inversion",
    example: `// Bad: the handler knows how storage works - untestable without a real DB
app.post("/orders", async (req, res) => {
  await pool.query("INSERT INTO orders (total) VALUES ($1)", [req.body.total]);
});

// Good: the handler depends on what it needs, not how it's done
function makeOrderHandler(orders /* { save(order) } */) {
  return async (req, res) => { await orders.save(req.body); res.sendStatus(201); };
}`,
    practice: "agbar learn refactoring 02-depend-on-an-interface",
    title: "Dependency inversion",
    category: "Design",
    failureScenario:
      "An order service imports the Postgres client directly. Swapping stores, or testing the service without a live database, means rewriting the service itself - the business rules and the storage detail are welded together.",
    fix: "Depend on an interface the high-level code defines, and let the concrete adapter implement it. The service says 'I need something that can save an order'; Postgres is one answer, an in-memory fake in a test is another, and the service is identical either way.",
  },
  {
    id: "single-responsibility",
    example: `// One function doing three jobs: parsing HTTP, applying a rule, storing data
async function handle(req, res) { /* read body, compute discount, write to DB */ }

// Split so each part changes for one reason - and the rule is testable alone
function discountFor(order) { /* pure business rule, no I/O */ }
async function handle(req, res) { await orders.save(applyDiscount(req.body)); }`,
    practice: "agbar learn refactoring 01-extract-the-domain",
    title: "Single responsibility",
    category: "Design",
    failureScenario:
      "One 600-line UserService handles validation, password hashing, email sending, billing, and audit logging. Changing an email template risks breaking billing, and no reviewer can read that diff with confidence.",
    fix: "Split by reason to change, not by line count. If two pieces of logic change for different reasons on different schedules, they belong apart. The quick test: can you describe what a unit does without using the word 'and'?",
  },
  {
    id: "separation-of-concerns",
    example: `// One function, three jobs: HTTP, a business rule, and storage
app.post("/orders", async (req, res) => {
  const total = req.body.items.reduce((s, i) => s + i.price * i.qty, 0) * 1.2;
  await pool.query("INSERT INTO orders (total) VALUES ($1)", [total]);
  res.json({ total });
});

// Good: each concern in its own place
const total = priceOrder(req.body.items);   // domain: pure, testable alone
await orders.save({ total });                // storage: behind an interface
res.json({ total });                         // transport: only HTTP`,
    practice: "agbar learn refactoring 01-extract-the-domain",
    title: "Separation of concerns",
    category: "Design",
    failureScenario:
      "A route handler parses the request, applies the business rules, builds SQL, formats the response, and logs to three places. None of it can be tested or reused without constructing an HTTP request.",
    fix: "Give each layer one job: transport handles HTTP, the domain holds rules that don't know HTTP exists, persistence talks to the database. Business logic that imports no web framework tests in milliseconds and can be reused from a queue consumer or a CLI.",
  },
  {
    id: "coupling-and-cohesion",
    example: `// 8 constructor dependencies usually means several classes in one
class BloatedOrderService {
  constructor(db, cache, mailer, pdf, payments, tax, audit, flags) {}
}

// Group what changes together; the service keeps only what it truly uses
class OrderService { constructor(orders, payments, notifier) {} }
class InvoiceRenderer { constructor(pdf, tax) {} }`,
    practice: "agbar learn refactoring 01-extract-the-domain",
    title: "Coupling and cohesion",
    category: "Design",
    failureScenario:
      "Changing one module's internal field breaks four others that reached into it. Meanwhile the logic for a single feature is scattered across six files, so every change to it touches all six.",
    fix: "Low coupling: modules interact through narrow, stable interfaces rather than each other's internals. High cohesion: things that change together live together. The measurable outcome is a feature change touching one folder instead of six.",
  },
  {
    id: "dry-principle",
    example: `// Bad: the same rule in two places - one gets fixed, the other doesn't
const vatAtCheckout = subtotal * 0.2;   // checkout.js
const vatOnInvoice = subtotal * 0.2;    // invoice.js

// Good: one source of truth for the rule
export const vatFor = (subtotal) => subtotal * VAT_RATE;

// But don't merge code that only LOOKS alike: if two things change for
// different reasons, duplication is cheaper than the wrong abstraction.`,
    title: "DRY, and when not to apply it",
    category: "Design",
    failureScenario:
      "The same tax calculation is copy-pasted across three services. A rate change updates two of them, and the third quietly bills the old rate for months before anyone notices.",
    fix: "One authoritative home per piece of knowledge. But DRY is about knowledge, not characters: two functions that look identical today and will change for different reasons tomorrow should stay separate. A wrong abstraction is more expensive to unpick than duplication is to maintain.",
  },
  {
    id: "microservices-vs-monolith",
    example: `A modular monolith: one deploy, enforced boundaries between modules.

  src/billing/   exports BillingService; owns the billing tables
  src/orders/    calls BillingService - never billing's tables directly

Split a module into its own service only when it needs its own scaling,
deploy cadence, or team. With the boundary already there, it's a move,
not a rewrite.`,
    title: "Microservices vs. a modular monolith",
    category: "Design",
    failureScenario:
      "A six-person team splits a new product into nine services. Every feature now touches three repos, local development needs docker-compose to boot the world, a single request spans four network hops nobody can trace, and the boundaries turn out to be wrong six months in - by which point moving them means coordinating deploys instead of moving a folder.",
    fix: "Start as a modular monolith: real domain boundaries, encapsulated modules, controlled dependencies - one deployable. You get the structural discipline without the distributed-systems tax, and boundaries stay cheap to move while you're still learning where they belong. Split out a service when a specific, named pressure demands it, not preemptively.",
    whenToUse:
      "Split when something concrete forces it: a component needs to scale independently, two areas need radically different deploy cadences (checkout ships daily, billing quarterly), or team count makes one codebase contended. As rough thresholds, teams under ~30 engineers and systems under ~1M requests/day rarely clear that bar. Treat 'we'll need it eventually' as a reason to keep modules clean, not a reason to distribute them - roughly 42% of organizations that adopted microservices are now consolidating services back, citing debugging complexity and operational overhead.",
    references: [
      {
        title: "Monolith vs Microservices: a 2026 decision framework",
        url: "https://www.developers.dev/tech-talk/monolith-vs-microservices-a-pragmatic-decision-framework-for-ctos-architects.html",
      },
      {
        title: "When to stop breaking things apart",
        url: "https://www.coderio.com/blog/innovation/monolith-vs-microservices-architecture-stop-breaking-things-apart/",
      },
    ],
  },
];
