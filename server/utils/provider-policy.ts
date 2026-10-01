import { H3Event } from 'h3'
import { resolveProviderAvailability, type ProviderAvailability } from '../../utils/auth-client'
import { isAppleConfigured } from './apple'
import { getEnv } from './env'

export const getProviderAvailability = (
  event: H3Event,
  input: { clientId: string; siwaPreview?: boolean },
): ProviderAvailability => {
  const env = getEnv(event)
  return resolveProviderAvailability({
    clientId: input.clientId,
    appleConfigured: isAppleConfigured(env),
    siwaFlag: String(env.SIWA_ENABLED || ''),
    siwaPreview: Boolean(input.siwaPreview),
    storeSocialFlag: String(env.STORE_CLIENTS_SOCIAL_LOGIN || '').trim() === '1',
    extraStoreIds: env.NATIVE_STORE_CLIENT_IDS || '',
  })
}
