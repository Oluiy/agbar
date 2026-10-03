/**
 * Files buildquick adds on top of AdonisJS's own `api` starter kit. Written in the kit's
 * style (single quotes, no semicolons) so the project reads as one codebase, and using
 * Adonis's own building blocks - Lucid, VineJS, Japa, @adonisjs/limiter - rather than
 * importing a second way of doing each thing.
 */

/** Sorts after the kit's and the limiter's migrations, which use real timestamps. */
export const ITEMS_MIGRATION = "database/migrations/1800000000000_create_items_table.ts";

export function itemsMigration(): string {
  return `import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'items'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      // Indexed because listing sorts and filters on it: an unindexed name column is the
      // first thing to hurt once the table grows.
      table.string('name', 200).notNullable().index()
      table.text('description').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  /** Reversible on purpose: a migration you cannot roll back is a one-way door. */
  async down() {
    this.schema.dropTable(this.tableName)
  }
}
`;
}

export function itemModel(): string {
  return `import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { DateTime } from 'luxon'

/**
 * A classic Lucid model. (The kit's own models extend classes generated into
 * database/schema.ts by "migration:run"; this one is declared directly, so it works
 * before any migration has been run - including on a fresh clone and in CI.)
 */
export default class Item extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare description: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
`;
}

export function itemValidator(): string {
  return `import vine from '@vinejs/vine'

/** Hard ceiling on a page. Validation rejects anything above it before any query runs. */
export const MAX_PER_PAGE = 200

export const createItemValidator = vine.create({
  name: vine.string().trim().minLength(1).maxLength(200),
  description: vine.string().trim().maxLength(1000).nullable().optional(),
})

export const listItemsValidator = vine.create({
  page: vine.number().withoutDecimals().min(1).optional(),
  perPage: vine.number().withoutDecimals().min(1).max(MAX_PER_PAGE).optional(),
})
`;
}

export function itemsController(): string {
  return `import Item from '#models/item'
import { createItemValidator, listItemsValidator } from '#validators/item'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * HTTP only: validate, query, respond. Validation failures become 422s and a missing row a
 * 404 through Adonis's own exception handler, so there is no try/catch here.
 */
export default class ItemsController {
  async index({ request }: HttpContext) {
    const { page = 1, perPage = 50 } = await request.validateUsing(listItemsValidator)
    // paginate() always applies LIMIT/OFFSET and returns the total: never an unbounded read.
    return Item.query().orderBy('id', 'asc').paginate(page, perPage)
  }

  async store({ request, response }: HttpContext) {
    const payload = await request.validateUsing(createItemValidator)
    const item = await Item.create({ name: payload.name, description: payload.description ?? null })
    return response.created(item)
  }

  async show({ params }: HttpContext) {
    return Item.findOrFail(params.id)
  }
}
`;
}

export function healthController(): string {
  return `import db from '@adonisjs/lucid/services/db'
import type { HttpContext } from '@adonisjs/core/http'

export default class HealthController {
  /**
   * Liveness: "am I running?" Cheap on purpose - it must not touch the database, or a slow
   * database makes the orchestrator restart a perfectly healthy process.
   */
  async live() {
    return { status: 'ok' }
  }

  /**
   * Readiness: "can I serve traffic?" - so it actually queries the database, and returns
   * 503 when it cannot, so the load balancer pulls the instance instead of sending it work.
   */
  async ready({ response }: HttpContext) {
    try {
      await db.rawQuery('select 1')
      return { status: 'ready', database: 'ok' }
    } catch {
      return response.serviceUnavailable({ status: 'not ready', database: 'unreachable' })
    }
  }
}
`;
}

/** Appended to the kit's start/routes.ts, so its own routes stay exactly as shipped. */
export function routesAppendix(): string {
  return `
/*
|--------------------------------------------------------------------------
| Added by buildquick
|--------------------------------------------------------------------------
|
| Health probes, and the items example feature. Import declarations are
| hoisted, so appending them here is valid and leaves the kit's routes above
| untouched.
|
*/
import { throttle } from '#start/limiter'

const HealthController = () => import('#controllers/health_controller')
const ItemsController = () => import('#controllers/items_controller')

// Probes sit outside the version prefix and are never rate limited: they point at a fixed
// path, and a throttled probe reports a false outage.
router.get('/health', [HealthController, 'live'])
router.get('/api/v1/health/ready', [HealthController, 'ready'])

router
  .group(() => {
    router.get('items', [ItemsController, 'index'])
    router.post('items', [ItemsController, 'store'])
    router.get('items/:id', [ItemsController, 'show']).where('id', router.matchers.number())
  })
  .prefix('/api/v1')
  // Per-client rate limiting for the whole group, set once so a route added later is covered.
  .use(throttle)
`;
}

export function limiterTs(): string {
  return `/*
|--------------------------------------------------------------------------
| Define HTTP limiters
|--------------------------------------------------------------------------
|
| "throttle" is applied to the API route group in start/routes.ts. Tune it with
| RATE_LIMIT_REQUESTS (per client, per minute).
|
*/

import env from '#start/env'
import limiter from '@adonisjs/limiter/services/main'

export const throttle = limiter.define('global', () => {
  return limiter.allowRequests(env.get('RATE_LIMIT_REQUESTS', 100)).every('1 minute')
})
`;
}

export function healthSpec(): string {
  return `import { test } from '@japa/runner'

test.group('Health', () => {
  test('liveness is unversioned, because probes point at a fixed path', async ({ client }) => {
    const response = await client.get('/health')

    response.assertStatus(200)
    response.assertBodyContains({ status: 'ok' })
  })

  test('readiness actually queries the database', async ({ client }) => {
    const response = await client.get('/api/v1/health/ready')

    response.assertStatus(200)
    response.assertBody({ status: 'ready', database: 'ok' })
  })
})
`;
}

export function itemsSpec(): string {
  return `import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'

test.group('Items', (group) => {
  // Every test runs inside a transaction that is rolled back, so tests never see each
  // other's rows - and starts with an empty limiter, so earlier requests never count
  // against it.
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(() => limiter.clear())

  test('creates an item, then reads it back', async ({ client, assert }) => {
    const created = await client.post('/api/v1/items').json({ name: 'first', description: 'hello' })
    created.assertStatus(201)

    const fetched = await client.get(\`/api/v1/items/\${created.body().id}\`)
    fetched.assertStatus(200)
    assert.equal(fetched.body().name, 'first')
  })

  test('a missing item is a 404, not a 500', async ({ client }) => {
    const response = await client.get('/api/v1/items/999999')

    response.assertStatus(404)
  })

  test('a blank name is rejected', async ({ client }) => {
    const response = await client.post('/api/v1/items').json({ name: '   ' })

    response.assertStatus(422)
  })

  test('lists a bounded page with the total, and refuses a page size above the ceiling', async ({ client, assert }) => {
    for (const name of ['a', 'b', 'c']) {
      await client.post('/api/v1/items').json({ name })
    }

    const page = await client.get('/api/v1/items').qs({ perPage: 2 })
    page.assertStatus(200)
    assert.lengthOf(page.body().data, 2)
    assert.equal(page.body().meta.total, 3)

    const tooBig = await client.get('/api/v1/items').qs({ perPage: 10000 })
    tooBig.assertStatus(422)
  })
})

test.group('Rate limiting', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(() => limiter.clear())

  test('throttles a client over the limit, but never the health probes', async ({ client, assert }) => {
    // .env.test sets RATE_LIMIT_REQUESTS=5 and the in-memory store.
    const statuses: number[] = []
    for (let i = 0; i < 7; i++) {
      statuses.push((await client.get('/api/v1/items')).status())
    }

    assert.includeMembers(statuses, [429])
    ;(await client.get('/health')).assertStatus(200)
    ;(await client.get('/api/v1/health/ready')).assertStatus(200)
  })
})
`;
}

export function architectureMd(projectName: string): string {
  return `# Architecture

${projectName}, generated with buildquick on top of AdonisJS's own \`api\` starter kit
(\`npm create adonisjs -- --kit=api\`). The kit supplies the application shell, auth
(signup, login, access tokens) and its conventions; buildquick adds the items example
feature, health probes, rate limiting, and tests. This records the decisions so the next
person does not have to reverse-engineer them.

## Where things live (Adonis conventions)

\`\`\`
app/controllers/   HTTP only - items_controller.ts, health_controller.ts
app/models/        Lucid models - item.ts
app/validators/    VineJS schemas - item.ts
database/migrations/
start/routes.ts    the kit's routes, then buildquick's (appended, clearly marked)
start/limiter.ts   the rate-limit policy
tests/functional/  Japa HTTP tests
\`\`\`

## Decisions already made for you

| Decision | Why |
|---|---|
| **Built on the official starter kit** | The Adonis team maintains the shell, auth and tooling versions; buildquick only adds what the kit does not. Generating with the framework's own CLI keeps a new project current. |
| **Per-client rate limiting** (\`@adonisjs/limiter\`, database store) | One misbehaving client or a credential-stuffing bot should not take the service down. Added with \`node ace add\`, applied to the whole API group. The database store survives restarts and is shared across instances; tests use the in-memory store. Tune with \`RATE_LIMIT_REQUESTS\`. |
| **Paginated and capped at 200** | \`paginate()\` always applies LIMIT/OFFSET and returns the total. \`perPage\` is validated with a maximum, so a client cannot ask for the whole table. |
| **Liveness and readiness are separate** | \`/health\` never touches the database. \`/api/v1/health/ready\` queries it and returns 503 on failure. Neither is throttled. |
| **Tests use their own database** | \`config/database.ts\` points tests at \`tmp/test.sqlite3\`, not the development database, and each test runs in a transaction that is rolled back. |
| **Migrations own the schema** | Every change is a reviewable, reversible migration. |
| **Node 24+** | \`@adonisjs/core\` 7 requires it. |

## Where to add things

| You want to... | Do this |
|---|---|
| Add a resource | \`node ace make:controller\`, \`make:model -m\`, \`make:validator\` - Adonis's own generators. |
| Change the schema | \`node ace make:migration\`, then \`node ace migration:run\`. Never edit one that has been applied. |
| Protect a route | The kit's \`middleware.auth()\`, as on its \`account\` routes. |

## What this scaffold deliberately does not include

Caching, tracing and a message queue. Each is a real decision that depends on your
deployment. Run \`buildquick check\` on this project to see what it still flags, with the
reasoning.
`;
}
