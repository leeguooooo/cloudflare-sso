import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireAccountUserContext } from '../../../../utils/account'
import { executeMerge, isProposalActionable, loadMergeProposal } from '../../../../utils/account-merge'
import { writeAuditLog } from '../../../../utils/audit'

/** POST /api/account/merge/:id — merge the other account into the signed-in one. Retryable. */
export default defineEventHandler(async (event) => {
  const ctx = await requireAccountUserContext(event)
  const gaid = ctx.globalAccount?.id
  if (!gaid) throw createError({ statusCode: 400, statusMessage: 'Global account not found' })
  const proposal = await loadMergeProposal(event, String(getRouterParam(event, 'id') || ''), gaid)
  if (proposal.status === 'done') return { ok: true, status: 'done' }
  if (!isProposalActionable(proposal)) {
    throw createError({ statusCode: 410, statusMessage: 'This merge request has expired. Link the account again to start over.' })
  }
  const result = await executeMerge(event, proposal)
  await writeAuditLog(event, {
    tenantId: ctx.user.tenant_id,
    userId: ctx.user.id,
    action: 'account.merge',
    payload: {
      merge_id: proposal.id,
      provider: proposal.provider,
      from_global_account_id: proposal.from_global_account_id,
      to_global_account_id: gaid,
      adopted_password: Boolean((result as { adoptedPassword?: boolean }).adoptedPassword),
    },
  }).catch(() => undefined)
  return { ok: true, status: result.status }
})
