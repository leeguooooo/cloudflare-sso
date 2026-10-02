/**
 * Cron trigger for the SSO's billing reconciliation (Pages Functions cannot run on a schedule).
 * Calls POST /api/internal/billing/reconcile and forwards any alerts to ALERT_WEBHOOK_URL
 * (Lark, Discord or Slack-style incoming webhook).
 */
type Env = {
  SSO_BASE_URL: string
  RECONCILE_SECRET: string
  ALERT_WEBHOOK_URL?: string
}

type Report = { alerts?: string[]; expired_subscriptions?: string[]; repaired_entitlements?: string[] }

const webhookBody = (url: string, text: string) => {
  if (/feishu|larksuite/.test(url)) return { msg_type: 'text', content: { text } }
  if (/discord(app)?\.com/.test(url)) return { content: text }
  return { text }
}

const notify = async (env: Env, text: string) => {
  if (!env.ALERT_WEBHOOK_URL) return
  await fetch(env.ALERT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(webhookBody(env.ALERT_WEBHOOK_URL, text)),
  })
}

const run = async (env: Env) => {
  const response = await fetch(new URL('/api/internal/billing/reconcile', env.SSO_BASE_URL), {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RECONCILE_SECRET}` },
  })
  if (!response.ok) {
    await notify(env, `[sso] billing reconcile failed: HTTP ${response.status}`)
    throw new Error(`reconcile failed: ${response.status}`)
  }
  const report = (await response.json()) as Report
  console.log('reconcile', {
    expired: report.expired_subscriptions?.length || 0,
    repaired: report.repaired_entitlements?.length || 0,
    alerts: report.alerts || [],
  })
  if (report.alerts?.length) await notify(env, `[sso] ${report.alerts.join('\n')}`)
  return report
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(run(env))
  },
}
