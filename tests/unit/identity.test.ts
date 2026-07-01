import { describe, expect, it } from 'vitest'
import { ensureClientManagementSchema } from '../../server/utils/identity'

class FakeD1Database {
  readonly columns = new Set<string>()
  readonly statements: string[] = []

  constructor(columns: string[]) {
    for (const column of columns) {
      this.columns.add(column)
    }
  }

  prepare(sql: string) {
    this.statements.push(sql)

    return {
      all: async () => {
        if (/^PRAGMA table_info\(clients\)/i.test(sql.trim())) {
          return {
            results: Array.from(this.columns, (name) => ({ name })),
          }
        }
        return { results: [] }
      },
      run: async () => {
        if (/ALTER TABLE clients ADD COLUMN status/i.test(sql)) {
          this.columns.add('status')
        }
        if (/ALTER TABLE clients ADD COLUMN updated_at/i.test(sql)) {
          this.columns.add('updated_at')
        }
        if (/UPDATE clients[\s\S]+created_at/i.test(sql) && !this.columns.has('created_at')) {
          throw new Error('no such column: created_at')
        }
        return { success: true }
      },
    }
  }
}

const eventWithDb = (db: FakeD1Database) =>
  ({
    context: {
      cloudflare: {
        env: {
          DB: db,
        },
      },
    },
  }) as any

describe('ensureClientManagementSchema', () => {
  it('backfills client management columns without requiring legacy created_at', async () => {
    const db = new FakeD1Database(['id', 'tenant_id', 'client_id', 'redirect_uris'])

    await expect(ensureClientManagementSchema(eventWithDb(db))).resolves.toBeUndefined()

    expect(db.columns.has('status')).toBe(true)
    expect(db.columns.has('updated_at')).toBe(true)
    expect(db.statements.some((sql) => /UPDATE clients[\s\S]+created_at/i.test(sql))).toBe(false)
  })
})
