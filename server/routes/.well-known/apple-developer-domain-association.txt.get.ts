import { createError, defineEventHandler, setResponseHeader } from 'h3'
import { getEnv } from '../../utils/env'

/**
 * Domain-association file for Sign in with Apple on the web, if the developer portal
 * asks for one when the domain is added to the Services ID. Its contents go into the
 * APPLE_DOMAIN_ASSOCIATION secret; 404 while unset.
 */
export default defineEventHandler((event) => {
  const content = (getEnv(event).APPLE_DOMAIN_ASSOCIATION || '').trim()
  if (!content) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
  return content
})
