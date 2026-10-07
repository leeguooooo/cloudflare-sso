import { describe, expect, it } from 'vitest'
import { publicHostFor } from '../../server/utils/public-host'

describe('public host restore (ESA)', () => {
  it('serves as the forwarded public host when it is trusted', () => {
    expect(publicHostFor('cloudflare-sso.pages.dev', 'account.leeguoo.com')).toBe('account.leeguoo.com')
    expect(publicHostFor('cloudflare-sso.pages.dev', 'SSO.leeguoo.com, proxy.example')).toBe('sso.leeguoo.com')
  })

  it('ignores unknown or missing forwarded hosts', () => {
    expect(publicHostFor('cloudflare-sso.pages.dev', 'evil.example')).toBeNull()
    expect(publicHostFor('cloudflare-sso.pages.dev', undefined)).toBeNull()
    expect(publicHostFor('account.leeguoo.com', 'account.leeguoo.com')).toBeNull()
  })
})
