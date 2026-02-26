import { describe, expect, it } from 'vitest'
import { normalizeRedirectUriForMatch } from '../../server/utils/redirect-uri'

describe('normalizeRedirectUriForMatch', () => {
  it('normalizes trailing slash for http and https URIs', () => {
    expect(normalizeRedirectUriForMatch('https://blog.misonote.com/callback/')).toBe(
      'https://blog.misonote.com/callback'
    )
    expect(normalizeRedirectUriForMatch('http://blog.misonote.com/callback///')).toBe(
      'http://blog.misonote.com/callback'
    )
  })

  it('keeps non-http schemes untouched', () => {
    expect(normalizeRedirectUriForMatch('paste://oauth/callback')).toBe('paste://oauth/callback')
  })

  it('returns empty string for blank input', () => {
    expect(normalizeRedirectUriForMatch('')).toBe('')
  })

  it('returns original string when URL parsing fails', () => {
    expect(normalizeRedirectUriForMatch('not a url')).toBe('not a url')
  })
})
