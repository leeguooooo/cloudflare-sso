import { createError, H3Event } from 'h3'
import { getEnv } from './env'

export type OutgoingEmail = { to: string; subject: string; text: string; html: string }

type EmailEnv = { RESEND_API_KEY?: string; EMAIL_FROM?: string; EMAIL_TRANSPORT?: string }

/** Messages captured by EMAIL_TRANSPORT=log (local dev and tests). */
export const capturedEmails: OutgoingEmail[] = []

/**
 * Sending is configured either with Resend (RESEND_API_KEY + EMAIL_FROM) or, for local work,
 * EMAIL_TRANSPORT=log. Without either, email-based flows (password reset, verification,
 * email change) are switched off and the UI hides them.
 */
export const isEmailEnabled = (env: EmailEnv) =>
  env.EMAIL_TRANSPORT === 'log' || Boolean(env.RESEND_API_KEY && env.EMAIL_FROM)

export const sendEmail = async (event: H3Event, message: OutgoingEmail) => {
  const env = getEnv(event) as EmailEnv
  if (env.EMAIL_TRANSPORT === 'log') {
    capturedEmails.push(message)
    console.info('email (log transport)', { to: message.to, subject: message.subject, text: message.text })
    return
  }
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw createError({ statusCode: 503, statusMessage: 'Email sending is not configured' })
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error('email send failed', { status: response.status, detail: detail.slice(0, 300) })
    throw createError({ statusCode: 502, statusMessage: 'Could not send email' })
  }
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A plain, single-action message: one paragraph, one button, the raw link as fallback. */
export const actionEmail = (input: { to: string; subject: string; intro: string; action: string; url: string; outro: string }): OutgoingEmail => ({
  to: input.to,
  subject: input.subject,
  text: `${input.intro}\n\n${input.action}: ${input.url}\n\n${input.outro}`,
  html: `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1f1f1f;line-height:1.5;max-width:480px;margin:24px auto;padding:0 16px">
<p>${escapeHtml(input.intro)}</p>
<p><a href="${escapeHtml(input.url)}" style="display:inline-block;background:#1a73e8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px">${escapeHtml(input.action)}</a></p>
<p style="font-size:13px;color:#5f6368;word-break:break-all">${escapeHtml(input.url)}</p>
<p style="font-size:13px;color:#5f6368">${escapeHtml(input.outro)}</p>
</body></html>`,
})
