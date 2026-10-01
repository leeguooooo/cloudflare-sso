import { createError, defineEventHandler, getRouterParam, setResponseHeader } from 'h3'
import { requireAccountUserContext } from '../../../../utils/account'
import { describeAccount, isProposalActionable, loadMergeProposal, precheckMerge } from '../../../../utils/account-merge'

/** GET /api/account/merge/:id — what merging the other account into this one would do. */
export default defineEventHandler(async (event) => {
  const ctx = await requireAccountUserContext(event)
  setResponseHeader(event, 'cache-control', 'no-store')
  const gaid = ctx.globalAccount?.id
  if (!gaid) throw createError({ statusCode: 400, statusMessage: 'Global account not found' })
  const proposal = await loadMergeProposal(event, String(getRouterParam(event, 'id') || ''), gaid)
  const other = await describeAccount(event, proposal.from_global_account_id)
  const current = await describeAccount(event, gaid)
  const actionable = isProposalActionable(proposal) && Boolean(other)
  const checks = actionable ? await precheckMerge(event, proposal) : []
  return {
    id: proposal.id,
    status: proposal.status,
    error: proposal.error || null,
    provider: proposal.provider,
    actionable,
    expires_at: proposal.expires_at,
    other,
    current,
    // When only the other account has a password, this account takes over its email + password.
    password_note: other && current ? (other.has_password ? (current.has_password ? 'other_password_stops' : 'adopt_other_password') : null) : null,
    apps: checks.map((check) => ({
      ok: check.ok,
      code: check.code || null,
      message: check.message || null,
      data: check.data || null,
    })),
  }
})
