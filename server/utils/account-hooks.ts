/**
 * Server-to-server hooks of connected apps (today: the Pastyx API), so app data
 * follows identity changes made on the issuer:
 *
 *   POST <base>/merge  {fromUserId, toUserId, dryRun?}  — move everything of `from` to `to`
 *   POST <base>/delete {userId}                         — delete everything of the user
 *
 * User ids are global account ids (gaid), which is what the apps key their data on.
 * Auth: `Authorization: Bearer <ACCOUNT_HOOK_SECRET>`. Hooks must be idempotent.
 */
import { H3Event } from 'h3'
import { getEnv } from './env'

export type HookResult = {
  url: string
  ok: boolean
  status: number
  code?: string
  message?: string
  data?: Record<string, unknown>
}

export const listHookBases = (raw: string | undefined) =>
  (raw || '')
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter((item) => /^https?:\/\//.test(item))

const callOne = async (url: string, secret: string, body: Record<string, unknown>): Promise<HookResult> => {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean
      code?: string
      message?: string
      data?: Record<string, unknown>
    } | null
    return {
      url,
      ok: response.ok && payload?.ok !== false,
      status: response.status,
      code: payload?.code,
      message: payload?.message,
      data: payload?.data,
    }
  } catch (error) {
    return { url, ok: false, status: 0, message: error instanceof Error ? error.message : 'network error' }
  }
}

export const callAccountHooks = async (
  event: H3Event,
  action: 'merge' | 'delete',
  body: Record<string, unknown>,
): Promise<HookResult[]> => {
  const env = getEnv(event)
  const bases = listHookBases(env.ACCOUNT_HOOK_URLS)
  if (!bases.length) return []
  const secret = (env.ACCOUNT_HOOK_SECRET || '').trim()
  if (!secret) {
    return bases.map((base) => ({ url: `${base}/${action}`, ok: false, status: 0, message: 'ACCOUNT_HOOK_SECRET is not set' }))
  }
  return Promise.all(bases.map((base) => callOne(`${base}/${action}`, secret, body)))
}
