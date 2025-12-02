import { defineEventHandler } from 'h3'
import { getPublicJwk } from '../utils/jwt'

export default defineEventHandler(async (event) => {
  const jwk = await getPublicJwk(event)
  return { keys: [jwk] }
})
