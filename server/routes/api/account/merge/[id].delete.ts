import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireAccountUserContext } from '../../../../utils/account'
import { loadMergeProposal } from '../../../../utils/account-merge'
import { getDb } from '../../../../utils/env'

/** DELETE /api/account/merge/:id — dismiss a merge proposal (nothing changes). */
export default defineEventHandler(async (event) => {
  const ctx = await requireAccountUserContext(event)
  const gaid = ctx.globalAccount?.id
  if (!gaid) throw createError({ statusCode: 400, statusMessage: 'Global account not found' })
  const proposal = await loadMergeProposal(event, String(getRouterParam(event, 'id') || ''), gaid)
  if (proposal.status === 'proposed' || proposal.status === 'refused' || proposal.status === 'failed') {
    await getDb(event)
      .prepare(`UPDATE account_merges SET status = 'cancelled', updated_at = strftime('%s', 'now') WHERE id = ?`)
      .bind(proposal.id)
      .run()
  }
  return { ok: true }
})
