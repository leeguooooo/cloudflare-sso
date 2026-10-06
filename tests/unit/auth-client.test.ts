import { describe, expect, it } from 'vitest'
import {
  AUTH_COPY,
  clientAppName,
  detectAuthLocale,
  hideSocialLogin,
  isNativeStoreClient,
  requestedClientId,
  safeContinuePath,
} from '../../utils/auth-client'

const authorizeContinue = (clientId: string, extra = '') =>
  `/authorize?response_type=code&client_id=${clientId}&redirect_uri=pastyx%3A%2F%2Fauth%2Fcallback${extra}`

describe('auth-client: native App Store clients (Guideline 4.8)', () => {
  it('hides social login for the iOS and Mac App Store clients via client_id', () => {
    expect(hideSocialLogin({ client_id: 'leeguoo-pastyx-ios' })).toBe(true)
    expect(hideSocialLogin({ client_id: 'leeguoo-fishing-ios' })).toBe(true)
    expect(hideSocialLogin({ client_id: 'misonote-paste-macos' })).toBe(true)
  })

  it('reads the client from the continue URL when client_id is absent', () => {
    expect(hideSocialLogin({ continue: authorizeContinue('leeguoo-pastyx-ios') })).toBe(true)
    expect(requestedClientId({ continue: authorizeContinue('misonote-paste-macos') })).toBe('misonote-paste-macos')
  })

  it('keeps social login for web clients (blog, agentparty, chrome-use, paste web)', () => {
    for (const id of ['blog-web', 'agentparty-web', 'chrome-use-web', 'misonote-paste-web', 'misonote-app-web']) {
      expect(hideSocialLogin({ client_id: id })).toBe(false)
      expect(hideSocialLogin({ continue: authorizeContinue(id) })).toBe(false)
    }
    expect(hideSocialLogin({})).toBe(false)
  })

  it('accepts extra ids from runtime config', () => {
    expect(isNativeStoreClient('some-new-app', 'a, some-new-app')).toBe(true)
    expect(isNativeStoreClient('some-new-app', '')).toBe(false)
  })

  it('ignores protocol-relative / absolute continue targets', () => {
    expect(safeContinuePath('//evil.example/authorize?client_id=leeguoo-pastyx-ios')).toBe('')
    expect(hideSocialLogin({ continue: 'https://evil.example/authorize?client_id=leeguoo-pastyx-ios' })).toBe(false)
  })

  it('names the app for native clients only', () => {
    expect(clientAppName('leeguoo-pastyx-ios')).toBe('Pastyx')
    expect(clientAppName('blog-web')).toBe('')
  })
})

describe('auth-client: locale detection', () => {
  it('maps browser languages', () => {
    expect(detectAuthLocale({}, ['zh-Hans-CN'])).toBe('zh')
    expect(detectAuthLocale({}, ['ja-JP'])).toBe('ja')
    expect(detectAuthLocale({}, ['ko-KR'])).toBe('ko')
    expect(detectAuthLocale({}, ['de-DE', 'en-US'])).toBe('en')
    expect(detectAuthLocale({}, ['fr-FR'])).toBe('en')
    expect(detectAuthLocale({}, [])).toBe('en')
  })

  it('prefers OIDC ui_locales from the continue URL', () => {
    expect(detectAuthLocale({ continue: authorizeContinue('leeguoo-pastyx-ios', '&ui_locales=ja') }, ['en-US'])).toBe('ja')
  })

  it('has every key in every language', () => {
    const keys = Object.keys(AUTH_COPY.en).sort()
    for (const copy of Object.values(AUTH_COPY)) {
      expect(Object.keys(copy).sort()).toEqual(keys)
      for (const value of Object.values(copy)) expect(value.length).toBeGreaterThan(0)
    }
  })
})
