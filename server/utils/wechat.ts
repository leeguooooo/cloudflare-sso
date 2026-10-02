import { createError } from 'h3'
import type { OAuthIdentityProfile } from './oauth'

/**
 * WeChat sign-in, two entry points that share one identity:
 * - Website app (open.weixin.qq.com, QR code): WECHAT_WEB_APP_ID + WECHAT_WEB_APP_SECRET.
 * - Mini-programs (wx.login → code): WECHAT_MINIPROGRAMS maps an SSO client_id to its appid,
 *   e.g. {"cherry-consumer":{"appid":"wx123"}}; each secret is WECHAT_MP_SECRET_<APPID>.
 *
 * The identity subject is the unionid when WeChat returns one (all apps bound to the same
 * open-platform account), so the same person lands on the same SSO account from the website
 * and every mini-program. Without a unionid the subject falls back to `<appid>:<openid>`.
 */

export type WechatEnv = {
  WECHAT_WEB_APP_ID?: string
  WECHAT_WEB_APP_SECRET?: string
  WECHAT_MINIPROGRAMS?: string
  [key: string]: unknown
}

const API = 'https://api.weixin.qq.com'

export const isWechatWebEnabled = (env: WechatEnv) => Boolean(env.WECHAT_WEB_APP_ID && env.WECHAT_WEB_APP_SECRET)

export const wechatSubject = (appId: string, openid: string, unionid?: string) => (unionid ? unionid : `${appId}:${openid}`)

export const syntheticWechatEmail = async (subject: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`wechat:${subject}`))
  const hex = [...new Uint8Array(digest)].slice(0, 10).map((b) => b.toString(16).padStart(2, '0')).join('')
  return `wechat-${hex}@users.account.invalid`
}

type WechatError = { errcode?: number; errmsg?: string }

const wechatJson = async <T>(url: URL): Promise<T> => {
  const response = await fetch(url.toString())
  const payload = (await response.json().catch(() => null)) as (T & WechatError) | null
  if (!response.ok || !payload || (payload.errcode && payload.errcode !== 0)) {
    const detail = payload?.errmsg || `status ${response.status}`
    throw createError({ statusCode: 502, statusMessage: `WeChat request failed: ${detail}` })
  }
  return payload
}

const webConfig = (env: WechatEnv) => {
  const appId = String(env.WECHAT_WEB_APP_ID || '').trim()
  const secret = String(env.WECHAT_WEB_APP_SECRET || '').trim()
  if (!appId || !secret) throw createError({ statusCode: 501, statusMessage: 'WeChat sign-in is not configured' })
  return { appId, secret }
}

export const buildWechatAuthorizeUrl = (env: WechatEnv, redirectUri: string, state: string) => {
  const { appId } = webConfig(env)
  const url = new URL('https://open.weixin.qq.com/connect/qrconnect')
  url.searchParams.set('appid', appId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'snsapi_login')
  url.searchParams.set('state', state)
  return `${url.toString()}#wechat_redirect`
}

export const exchangeWechatWebCode = async (env: WechatEnv, code: string): Promise<OAuthIdentityProfile> => {
  const { appId, secret } = webConfig(env)
  const tokenUrl = new URL(`${API}/sns/oauth2/access_token`)
  tokenUrl.searchParams.set('appid', appId)
  tokenUrl.searchParams.set('secret', secret)
  tokenUrl.searchParams.set('code', code)
  tokenUrl.searchParams.set('grant_type', 'authorization_code')
  const token = await wechatJson<{ access_token: string; openid: string; unionid?: string }>(tokenUrl)

  const infoUrl = new URL(`${API}/sns/userinfo`)
  infoUrl.searchParams.set('access_token', token.access_token)
  infoUrl.searchParams.set('openid', token.openid)
  const info = await wechatJson<{ nickname?: string; headimgurl?: string; unionid?: string }>(infoUrl).catch(() => ({}) as Record<string, never>)
  const unionid = token.unionid || ('unionid' in info ? info.unionid : undefined)
  return {
    provider: 'wechat',
    subject: wechatSubject(appId, token.openid, unionid),
    name: 'nickname' in info ? info.nickname : undefined,
    avatarUrl: 'headimgurl' in info ? info.headimgurl : undefined,
    profile: { app_id: appId, openid: token.openid, unionid: unionid || null, source: 'web' },
  }
}

export const miniProgramFor = (env: WechatEnv, clientId: string) => {
  let map: Record<string, { appid?: string }> = {}
  try {
    map = JSON.parse(String(env.WECHAT_MINIPROGRAMS || '{}'))
  } catch {
    throw createError({ statusCode: 500, statusMessage: 'WECHAT_MINIPROGRAMS is not valid JSON' })
  }
  const appId = String(map[clientId]?.appid || '').trim()
  const secret = appId ? String(env[`WECHAT_MP_SECRET_${appId.toUpperCase()}`] || '').trim() : ''
  if (!appId || !secret) throw createError({ statusCode: 400, statusMessage: 'This client has no WeChat mini-program configured' })
  return { appId, secret }
}

/** wx.login() code → identity, via jscode2session. The session_key never leaves this function. */
export const exchangeMiniProgramCode = async (env: WechatEnv, clientId: string, code: string): Promise<OAuthIdentityProfile> => {
  const { appId, secret } = miniProgramFor(env, clientId)
  const url = new URL(`${API}/sns/jscode2session`)
  url.searchParams.set('appid', appId)
  url.searchParams.set('secret', secret)
  url.searchParams.set('js_code', code)
  url.searchParams.set('grant_type', 'authorization_code')
  const session = await wechatJson<{ openid: string; unionid?: string }>(url)
  return {
    provider: 'wechat',
    subject: wechatSubject(appId, session.openid, session.unionid),
    profile: { app_id: appId, openid: session.openid, unionid: session.unionid || null, source: 'miniprogram' },
  }
}
