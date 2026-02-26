import { describe, expect, it } from 'vitest'
import { parseOAuthProvider } from '../../server/utils/oauth'

describe('parseOAuthProvider', () => {
  it('accepts supported providers case-insensitively', () => {
    expect(parseOAuthProvider('github')).toBe('github')
    expect(parseOAuthProvider('GITHUB')).toBe('github')
    expect(parseOAuthProvider('google')).toBe('google')
  })

  it('throws createError on unsupported provider', () => {
    try {
      parseOAuthProvider('discord')
      expect.fail('expected parseOAuthProvider to throw')
    } catch (error) {
      expect((error as { statusCode?: number; statusMessage?: string }).statusCode).toBe(400)
      expect((error as { statusCode?: number; statusMessage?: string }).statusMessage).toBe('Unsupported provider')
    }
  })

  it('throws createError on blank provider', () => {
    try {
      parseOAuthProvider('')
      expect.fail('expected parseOAuthProvider to throw')
    } catch (error) {
      expect((error as { statusCode?: number; statusMessage?: string }).statusCode).toBe(400)
      expect((error as { statusCode?: number; statusMessage?: string }).statusMessage).toBe('Unsupported provider')
    }
  })
})
