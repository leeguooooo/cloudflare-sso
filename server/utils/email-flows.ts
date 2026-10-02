import { createError, H3Event } from 'h3'
import { getIssuer } from './auth'
import { issueEmailToken } from './account-email'
import { actionEmail, sendEmail } from './email'

const verifyLink = (event: H3Event, token: string) => {
  const link = new URL('/api/auth/email/verify', getIssuer(event))
  link.searchParams.set('token', token)
  return link.toString()
}

export const sendVerificationEmail = async (event: H3Event, globalAccountId: string, email: string) => {
  const token = await issueEmailToken(event, globalAccountId, 'verify_email')
  await sendEmail(
    event,
    actionEmail({
      to: email,
      subject: '验证你的邮箱 / Verify your email',
      intro: '请确认这是你的 leeguoo 账号邮箱。链接 24 小时内有效。 Please confirm this is the email of your leeguoo account.',
      action: '验证邮箱 / Verify email',
      url: verifyLink(event, token),
      outro: '如果你没有注册 leeguoo 账号，忽略这封邮件即可。 If you did not create an account, ignore this email.',
    }),
  )
}

export const sendEmailChangeConfirmation = async (event: H3Event, globalAccountId: string, newEmail: string) => {
  const token = await issueEmailToken(event, globalAccountId, 'change_email', newEmail)
  await sendEmail(
    event,
    actionEmail({
      to: newEmail,
      subject: '确认新的账号邮箱 / Confirm your new email',
      intro: '你的 leeguoo 账号申请把登录邮箱改成这个地址。点击确认后生效，链接 1 小时内有效。 Your account asked to switch its email to this address.',
      action: '确认更换 / Confirm change',
      url: verifyLink(event, token),
      outro: '如果不是你本人操作，忽略这封邮件即可，邮箱不会改变。 If this was not you, ignore this email.',
    }),
  )
}

export const normalizeEmail = (value: unknown) => {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid email address' })
  }
  return email
}
