/**
 * Runs the real Nitro route handlers against an in-memory SQLite database (node:sqlite) behind
 * a minimal D1 adapter, so OIDC flows can be tested end to end without wrangler.
 */
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { createApp, createRouter, eventHandler, toWebHandler, type EventHandler } from 'h3'

type Value = string | number | bigint | null | Uint8Array

const normalize = (params: unknown[]): Value[] =>
  params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : (p as Value)))

class Statement {
  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new Statement(this.sqlite, this.sql, params)
  }

  async first<T>(column?: string): Promise<T | null> {
    const row = this.sqlite.prepare(this.sql).get(...normalize(this.params)) as Record<string, unknown> | undefined
    if (!row) return null
    return (column ? row[column] : { ...row }) as T
  }

  async all<T>() {
    const rows = this.sqlite.prepare(this.sql).all(...normalize(this.params)) as Record<string, unknown>[]
    return { results: rows.map((row) => ({ ...row })) as T[], success: true }
  }

  async run() {
    const result = this.sqlite.prepare(this.sql).run(...normalize(this.params))
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
  }
}

export class FakeD1 {
  readonly sqlite = new DatabaseSync(':memory:')

  prepare(sql: string) {
    return new Statement(this.sqlite, sql)
  }

  async batch(statements: Statement[]) {
    this.sqlite.exec('BEGIN')
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      this.sqlite.exec('COMMIT')
      return results
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
    }
  }

  async exec(sql: string) {
    this.sqlite.exec(sql)
  }
}

const toPem = (der: ArrayBuffer) => {
  const b64 = Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n')
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----`
}

let sharedKey: string | null = null
/** One RSA key per test process: jwt.ts caches the signing key module-wide. */
export const signingKeyPem = async () => {
  if (!sharedKey) {
    const pair = (await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair
    sharedKey = toPem(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  }
  return sharedKey
}

export const ISSUER = 'https://sso.test'

export type Route = { method: 'get' | 'post' | 'put' | 'patch' | 'delete' | 'use'; path: string; handler: EventHandler }

export const createHarness = async (routes: Route[], envOverrides: Record<string, string> = {}) => {
  const db = new FakeD1()
  db.sqlite.exec(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'))
  const env = {
    DB: db,
    JWT_PRIVATE_KEY: await signingKeyPem(),
    JWT_KID: 'test-key',
    JWT_ISSUER: ISSUER,
    PASSWORD_PEPPER: 'pepper',
    DEFAULT_CLIENT_ID: 'acct-web',
    ...envOverrides,
  }
  const app = createApp()
  app.use(
    eventHandler((event) => {
      event.context.cloudflare = { env }
    }),
  )
  const router = createRouter()
  for (const route of routes) {
    if (route.method === 'use') router.use(route.path, route.handler)
    else router[route.method](route.path, route.handler)
  }
  app.use(router)
  const handler = toWebHandler(app)

  const request = (path: string, init: RequestInit & { cookie?: string; bearer?: string; form?: Record<string, string>; json?: unknown } = {}) => {
    const headers = new Headers(init.headers)
    if (init.cookie) headers.set('cookie', init.cookie)
    if (init.bearer) headers.set('authorization', `Bearer ${init.bearer}`)
    let body = init.body
    if (init.form) {
      headers.set('content-type', 'application/x-www-form-urlencoded')
      body = new URLSearchParams(init.form).toString()
    }
    if (init.json !== undefined) {
      headers.set('content-type', 'application/json')
      body = JSON.stringify(init.json)
    }
    return handler(new Request(`${ISSUER}${path}`, { ...init, headers, body, redirect: 'manual' }))
  }

  return { db, env, request }
}

export const cookieFrom = (response: Response, name: string) => {
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(';')
    const [key, value] = pair.split('=')
    if (key.trim() === name && value) return `${name}=${value}`
  }
  return ''
}

export const decodeJwt = (token: string) =>
  JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>

export const pkcePair = async () => {
  const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: Buffer.from(digest).toString('base64url') }
}
