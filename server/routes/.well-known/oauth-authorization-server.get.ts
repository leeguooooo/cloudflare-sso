import { defineEventHandler } from 'h3'
import { buildServerMetadata } from '../../utils/discovery'

// RFC 8414 — OAuth 2.0 Authorization Server Metadata. Mirrors the OIDC
// discovery document so agents/clients that probe the OAuth (rather than
// OpenID) well-known endpoint get valid JSON metadata instead of the SPA HTML.
export default defineEventHandler((event) => buildServerMetadata(event))
