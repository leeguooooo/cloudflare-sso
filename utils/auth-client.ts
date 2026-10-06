/**
 * Per-client presentation rules for the hosted login / register pages.
 *
 * Native App Store clients (iOS + Mac App Store builds) open these pages inside
 * ASWebAuthenticationSession. App Store Review Guideline 4.8 requires an
 * equivalent privacy-focused login option (Sign in with Apple) whenever a
 * third-party social login is offered. resolveProviderAvailability() decides:
 * store clients get Google / GitHub only when Apple is shown next to them and
 * the STORE_CLIENTS_SOCIAL_LOGIN flag is on; every other client gets them always.
 *
 * The client_id reaches the pages as `?client_id=` (added by /authorize) and is
 * also embedded in `?continue=/authorize?...client_id=...`; both are checked.
 */

export const NATIVE_STORE_CLIENT_IDS: ReadonlySet<string> = new Set([
  'leeguoo-pastyx-ios',
  'misonote-paste-macos',
])

/** Friendly product name shown in the sign-in sheet ("to continue to Pastyx"). */
export const CLIENT_APP_NAMES: Readonly<Record<string, string>> = {
  'leeguoo-pastyx-ios': 'Pastyx',
  'misonote-paste-macos': 'Pastyx',
  'leeguoo-jrkan-tv': 'JRKAN',
  'leeguoo-jrkan-ios': 'JRKAN',
}

/** Device named on the /device approval page for device-flow clients. */
export const CLIENT_DEVICE_NAMES: Readonly<Record<string, string>> = {
  'leeguoo-jrkan-tv': 'Apple TV',
}

type QueryLike = Record<string, unknown>

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** Only same-origin relative paths are honoured as `continue` targets. */
export const safeContinuePath = (raw: unknown): string => {
  const value = typeof raw === 'string' ? raw : ''
  if (!value.startsWith('/') || value.startsWith('//')) return ''
  // Browsers read `/\host` as `//host`; control characters are stripped by URL parsers.
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return ''
  return value
}

const continueParams = (query: QueryLike): URLSearchParams | null => {
  const continuePath = safeContinuePath(query.continue)
  if (!continuePath.startsWith('/authorize?')) return null
  return new URLSearchParams(continuePath.split('?')[1] || '')
}

/** client_id explicitly requested by the page URL (query first, then the continue URL). */
export const requestedClientId = (query: QueryLike): string => {
  const direct = str(query.client_id)
  if (direct) return direct
  return str(continueParams(query)?.get('client_id'))
}

const parseExtraIds = (extra?: string | readonly string[]): string[] => {
  if (!extra) return []
  const list = typeof extra === 'string' ? extra.split(',') : extra
  return list.map((item) => item.trim()).filter(Boolean)
}

export const isNativeStoreClient = (clientId: string, extra?: string | readonly string[]): boolean => {
  const id = clientId.trim()
  if (!id) return false
  return NATIVE_STORE_CLIENT_IDS.has(id) || parseExtraIds(extra).includes(id)
}

/** Whether Google / GitHub buttons must be hidden for this page request. */
export const hideSocialLogin = (query: QueryLike, extra?: string | readonly string[]): boolean =>
  isNativeStoreClient(requestedClientId(query), extra)

export type ProviderAvailability = { apple: boolean; google: boolean; github: boolean }

/** /api/auth/providers response: the per-client buttons plus server capabilities. */
export type ProviderResponse = ProviderAvailability & {
  /** Email sending is configured, so "forgot password" can mail a reset link. */
  password_reset?: boolean
  /** WeChat website sign-in is configured. */
  wechat?: boolean
}

export type ProviderPolicyInput = {
  clientId: string
  /** All four Apple secrets are present. */
  appleConfigured: boolean
  /** SIWA_ENABLED: '1' = on, 'test' = only with ?siwa=1, anything else = off. */
  siwaFlag: string
  /** The page URL carries ?siwa=1 (lets the owner try Apple in production before it is public). */
  siwaPreview: boolean
  /** STORE_CLIENTS_SOCIAL_LOGIN === '1'. */
  storeSocialFlag: boolean
  extraStoreIds?: string | readonly string[]
}

/**
 * Which sign-in buttons a page shows (and which /oauth/start accepts).
 *
 * App Store Guideline 4.8: a native App Store client may only see Google / GitHub
 * when Sign in with Apple is offered next to them. So for store clients, social
 * login requires BOTH Apple being available AND the explicit STORE_CLIENTS_SOCIAL_LOGIN
 * flag (flipped only after Apple was verified working in production).
 */
export const resolveProviderAvailability = (input: ProviderPolicyInput): ProviderAvailability => {
  const flag = input.siwaFlag.trim().toLowerCase()
  const appleOn = flag === '1' || flag === 'true' || flag === 'on'
  const apple = input.appleConfigured && (appleOn || (flag === 'test' && input.siwaPreview))
  const store = isNativeStoreClient(input.clientId, input.extraStoreIds)
  const social = !store || (apple && appleOn && input.storeSocialFlag)
  return { apple, google: social, github: social }
}

export const clientAppName = (clientId: string): string => CLIENT_APP_NAMES[clientId.trim()] || ''

export const clientDeviceName = (clientId: string): string => CLIENT_DEVICE_NAMES[clientId.trim()] || ''

// ---------------------------------------------------------------------------
// Copy (the pages are standalone designs, so they carry their own strings)
// ---------------------------------------------------------------------------

export type AuthLocale = 'en' | 'zh' | 'ja' | 'ko'

/**
 * Picks the page language: OIDC `ui_locales` (from the continue URL) first,
 * then the browser's languages. Unknown languages fall back to English.
 */
export const detectAuthLocale = (query: QueryLike, browserLanguages: readonly string[] = []): AuthLocale => {
  const uiLocales = str(continueParams(query)?.get('ui_locales'))
    .split(/\s+/)
    .filter(Boolean)
  for (const raw of [...uiLocales, ...browserLanguages]) {
    const tag = raw.toLowerCase()
    if (tag.startsWith('zh')) return 'zh'
    if (tag.startsWith('ja')) return 'ja'
    if (tag.startsWith('ko')) return 'ko'
    if (tag.startsWith('en')) return 'en'
  }
  return 'en'
}

export type AuthCopy = {
  loginKicker: string
  loginTitle: string
  loginSubtitle: string
  loginSubtitleApp: string // {app}
  registerKicker: string
  registerTitle: string
  registerSubtitle: string
  registerSubtitleApp: string // {app}
  apple: string
  appleSignup: string
  google: string
  github: string
  googleSignup: string
  githubSignup: string
  or: string
  email: string
  password: string
  forgot: string
  showPassword: string
  submitLogin: string
  submittingLogin: string
  submitRegister: string
  submittingRegister: string
  noAccount: string
  createOne: string
  haveAccount: string
  toLogin: string
  registered: string
  signedIn: string
  footer: string
  /** A provider sign-in whose email belongs to an existing account that is not linked to it. */
  accountExistsTitle: string
  accountExistsBody: string // {provider} {email}
  accountExistsAction: string
  appleUnavailable: string
  wechat: string
  wechatSignup: string
  forgotKicker: string
  forgotTitle: string
  forgotSubtitle: string
  forgotSubmit: string
  forgotSubmitting: string
  forgotSent: string
  tooMany: string
  backToLogin: string
  resetKicker: string
  resetTitle: string
  resetSubtitle: string
  newPassword: string
  confirmPassword: string
  resetSubmit: string
  resetSubmitting: string
  resetDone: string
  resetInvalid: string
  requestNew: string
  passwordTooShort: string
  passwordMismatch: string
  genericError: string
  deviceKicker: string
  deviceTitle: string
  deviceSubtitle: string
  deviceCodeLabel: string
  deviceContinue: string
  deviceRequest: string // {app} {device}
  deviceDefaultName: string
  deviceCompare: string
  deviceSignedInAs: string
  deviceSwitch: string
  deviceApprove: string
  deviceApproving: string
  deviceDeny: string
  deviceApproved: string // {device}
  deviceDenied: string
  deviceInvalid: string
  deviceExpired: string
  deviceUsed: string
  deviceOtherCode: string
  membershipKicker: string
  membershipTitle: string
  membershipUnavailable: string
  membershipStatusTrial: string // {date} {days}
  membershipStatusMember: string // {date}
  membershipStatusForever: string
  membershipStatusExpired: string // {date}
  membershipStatusNone: string
  membershipBuy: string
  membershipRenew: string
  membershipRedirecting: string
  membershipAfterPay: string
  membershipRefresh: string
}

export const AUTH_COPY: Readonly<Record<AuthLocale, AuthCopy>> = {
  en: {
    loginKicker: '✦ account center ✦',
    loginTitle: 'Welcome back',
    loginSubtitle: 'Sign in to your account.',
    loginSubtitleApp: 'Sign in with your leeguoo account to continue to {app}.',
    registerKicker: '✦ new account ✦',
    registerTitle: 'Create an account',
    registerSubtitle: 'One account for all apps.',
    registerSubtitleApp: 'Create a leeguoo account to use with {app}.',
    apple: 'Sign in with Apple',
    appleSignup: 'Sign up with Apple',
    google: 'Continue with Google',
    github: 'Continue with GitHub',
    googleSignup: 'Sign up with Google',
    githubSignup: 'Sign up with GitHub',
    or: 'or',
    email: 'Email',
    password: 'Password',
    forgot: 'Forgot?',
    showPassword: 'Show password',
    submitLogin: 'Sign in',
    submittingLogin: 'Signing in…',
    submitRegister: 'Create account',
    submittingRegister: 'Creating…',
    noAccount: 'No account yet?',
    createOne: 'Create one',
    haveAccount: 'Already have an account?',
    toLogin: 'Sign in →',
    registered: 'Account created. Please sign in.',
    signedIn: 'Signed in',
    footer: 'account.leeguoo.com · secure sign-in',
    accountExistsTitle: 'An account with this email already exists',
    accountExistsBody: '{email} is already registered, but this {provider} sign-in is not linked to it yet. For your security we never link accounts automatically. Sign in with the method you used before, then open Account → Sign-in methods and link {provider}.',
    accountExistsAction: 'Sign in with your existing method',
    appleUnavailable: 'Sign in with Apple is not available right now.',
    wechat: 'Continue with WeChat',
    wechatSignup: 'Sign up with WeChat',
    forgotKicker: '✦ password reset ✦',
    forgotTitle: 'Forgot your password?',
    forgotSubtitle: 'Enter your account email and we\'ll send you a reset link.',
    forgotSubmit: 'Send reset link',
    forgotSubmitting: 'Sending…',
    forgotSent: 'If that email is registered, a reset link is on its way. It expires in 30 minutes.',
    tooMany: 'Too many attempts. Please try again later.',
    backToLogin: '← Back to sign in',
    resetKicker: '✦ new password ✦',
    resetTitle: 'Choose a new password',
    resetSubtitle: 'Use at least 8 characters.',
    newPassword: 'New password',
    confirmPassword: 'Confirm new password',
    resetSubmit: 'Update password',
    resetSubmitting: 'Updating…',
    resetDone: 'Password updated. Sign in with your new password.',
    resetInvalid: 'This reset link is invalid or has expired.',
    requestNew: 'Request a new link',
    passwordTooShort: 'Password must be at least 8 characters.',
    passwordMismatch: 'Passwords do not match.',
    genericError: 'Something went wrong. Please try again.',
    deviceKicker: '✦ connect a device ✦',
    deviceTitle: 'Sign in on your TV',
    deviceSubtitle: 'Enter the code shown on your TV screen.',
    deviceCodeLabel: 'Code',
    deviceContinue: 'Continue',
    deviceRequest: '{app} on {device} wants to sign in with your leeguoo account.',
    deviceDefaultName: 'your device',
    deviceCompare: 'Only continue if this code matches the one on your screen.',
    deviceSignedInAs: 'Signed in as',
    deviceSwitch: 'Switch account',
    deviceApprove: 'Allow',
    deviceApproving: 'Allowing…',
    deviceDeny: 'Deny',
    deviceApproved: 'Done! {device} is signed in. You can go back to it now.',
    deviceDenied: 'Request denied. Nothing was signed in.',
    deviceInvalid: 'That code is not valid. Check the code on your screen and try again.',
    deviceExpired: 'That code has expired. Start the sign-in again on your device to get a new one.',
    deviceUsed: 'That code was already used.',
    deviceOtherCode: 'Enter another code',
    membershipKicker: '✦ membership ✦',
    membershipTitle: 'Membership',
    membershipUnavailable: 'Membership purchase is not open yet.',
    membershipStatusTrial: 'Free trial · {days} days left (until {date})',
    membershipStatusMember: 'Member until {date}',
    membershipStatusForever: 'Member',
    membershipStatusExpired: 'Membership expired on {date}',
    membershipStatusNone: 'Not a member yet',
    membershipBuy: 'Get membership',
    membershipRenew: 'Renew membership',
    membershipRedirecting: 'Opening afdian…',
    membershipAfterPay: 'After paying it takes effect within a few seconds. Go back to the app and refresh.',
    membershipRefresh: 'Refresh status',
  },
  zh: {
    loginKicker: '✦ account center ✦',
    loginTitle: '欢迎回来',
    loginSubtitle: '登录账号中心，继续你的折腾。',
    loginSubtitleApp: '使用 leeguoo 账号登录，继续使用 {app}。',
    registerKicker: '✦ new account ✦',
    registerTitle: '画一个新账号',
    registerSubtitle: '注册一个账号，解锁全部应用。',
    registerSubtitleApp: '注册一个 leeguoo 账号，用于 {app}。',
    apple: '通过 Apple 登录',
    appleSignup: '通过 Apple 注册',
    google: '使用 Google 继续',
    github: '使用 GitHub 继续',
    googleSignup: '使用 Google 注册',
    githubSignup: '使用 GitHub 注册',
    or: '或',
    email: '邮箱',
    password: '密码',
    forgot: '忘记了？',
    showPassword: '显示密码',
    submitLogin: '登录',
    submittingLogin: '登录中…',
    submitRegister: '注册',
    submittingRegister: '创建中…',
    noAccount: '还没有账号？',
    createOne: '注册一个 ✎',
    haveAccount: '已有账号？',
    toLogin: '去登录 →',
    registered: '账号已创建，请登录。',
    signedIn: '登录成功',
    footer: 'account.leeguoo.com · 安全登录',
    accountExistsTitle: '这个邮箱已经有账号了',
    accountExistsBody: '{email} 已经注册过，但还没有绑定这个 {provider} 账号。为了你的账号安全，我们不会自动合并。请先用原来的方式登录，再到「账号中心 → 登录方式」绑定 {provider}。',
    accountExistsAction: '用原来的方式登录',
    appleUnavailable: '暂时无法使用通过 Apple 登录。',
    wechat: '使用微信登录',
    wechatSignup: '使用微信注册',
    forgotKicker: '✦ password reset ✦',
    forgotTitle: '忘记密码了？',
    forgotSubtitle: '输入账号邮箱，我们会发一封重置密码的邮件给你。',
    forgotSubmit: '发送重置邮件',
    forgotSubmitting: '发送中…',
    forgotSent: '如果该邮箱已注册，你会收到一封重置邮件（30 分钟内有效）。',
    tooMany: '尝试次数太多，请稍后再试。',
    backToLogin: '← 返回登录',
    resetKicker: '✦ new password ✦',
    resetTitle: '设置新密码',
    resetSubtitle: '至少 8 个字符。',
    newPassword: '新密码',
    confirmPassword: '再次输入新密码',
    resetSubmit: '更新密码',
    resetSubmitting: '更新中…',
    resetDone: '密码已更新，请用新密码登录。',
    resetInvalid: '重置链接无效或已过期。',
    requestNew: '重新申请',
    passwordTooShort: '密码至少 8 个字符。',
    passwordMismatch: '两次输入的密码不一致。',
    genericError: '出了点问题，请稍后再试。',
    deviceKicker: '✦ connect a device ✦',
    deviceTitle: '在电视上登录',
    deviceSubtitle: '输入电视屏幕上显示的代码。',
    deviceCodeLabel: '代码',
    deviceContinue: '继续',
    deviceRequest: '{device} 上的 {app} 请求使用你的 leeguoo 账号登录。',
    deviceDefaultName: '你的设备',
    deviceCompare: '请确认这个代码和屏幕上显示的一致，再继续。',
    deviceSignedInAs: '当前账号',
    deviceSwitch: '切换账号',
    deviceApprove: '允许',
    deviceApproving: '正在允许…',
    deviceDeny: '拒绝',
    deviceApproved: '完成！{device} 已登录，可以回到设备上继续了。',
    deviceDenied: '已拒绝，设备没有登录。',
    deviceInvalid: '代码无效，请核对屏幕上的代码后重试。',
    deviceExpired: '代码已过期，请在设备上重新发起登录获取新代码。',
    deviceUsed: '这个代码已经用过了。',
    deviceOtherCode: '输入其他代码',
    membershipKicker: '✦ membership ✦',
    membershipTitle: '会员',
    membershipUnavailable: '会员购买暂未开放。',
    membershipStatusTrial: '免费试用 · 剩余 {days} 天（到 {date}）',
    membershipStatusMember: '会员有效期至 {date}',
    membershipStatusForever: '永久会员',
    membershipStatusExpired: '会员已于 {date} 过期',
    membershipStatusNone: '还不是会员',
    membershipBuy: '开通会员',
    membershipRenew: '续费会员',
    membershipRedirecting: '正在打开爱发电…',
    membershipAfterPay: '支付完成后几秒内生效，回到 App 刷新即可。',
    membershipRefresh: '刷新状态',
  },
  ja: {
    loginKicker: '✦ account center ✦',
    loginTitle: 'おかえりなさい',
    loginSubtitle: 'アカウントにサインインしてください。',
    loginSubtitleApp: 'leeguoo アカウントでサインインして {app} を続けます。',
    registerKicker: '✦ new account ✦',
    registerTitle: 'アカウントを作成',
    registerSubtitle: 'ひとつのアカウントですべてのアプリを利用できます。',
    registerSubtitleApp: '{app} で使う leeguoo アカウントを作成します。',
    apple: 'Appleでサインイン',
    appleSignup: 'Appleでサインアップ',
    google: 'Google で続ける',
    github: 'GitHub で続ける',
    googleSignup: 'Google で登録',
    githubSignup: 'GitHub で登録',
    or: 'または',
    email: 'メールアドレス',
    password: 'パスワード',
    forgot: 'お忘れですか？',
    showPassword: 'パスワードを表示',
    submitLogin: 'サインイン',
    submittingLogin: 'サインイン中…',
    submitRegister: 'アカウントを作成',
    submittingRegister: '作成中…',
    noAccount: 'アカウントをお持ちでないですか？',
    createOne: '作成する',
    haveAccount: 'すでにアカウントをお持ちですか？',
    toLogin: 'サインイン →',
    registered: 'アカウントを作成しました。サインインしてください。',
    signedIn: 'サインインしました',
    footer: 'account.leeguoo.com · 安全なサインイン',
    accountExistsTitle: 'このメールアドレスのアカウントは既に存在します',
    accountExistsBody: '{email} は登録済みですが、この {provider} アカウントはまだリンクされていません。安全のため、アカウントを自動でリンクすることはありません。以前の方法でサインインしてから、「アカウント → ログイン方法」で {provider} をリンクしてください。',
    accountExistsAction: '以前の方法でサインイン',
    appleUnavailable: '現在 Apple でサインインは利用できません。',
    wechat: 'WeChat で続ける',
    wechatSignup: 'WeChat で登録',
    forgotKicker: '✦ password reset ✦',
    forgotTitle: 'パスワードをお忘れですか？',
    forgotSubtitle: 'アカウントのメールアドレスを入力すると、再設定用のリンクをお送りします。',
    forgotSubmit: '再設定リンクを送信',
    forgotSubmitting: '送信中…',
    forgotSent: 'このメールアドレスが登録されていれば、再設定リンクを送信しました（30 分間有効）。',
    tooMany: '試行回数が多すぎます。しばらくしてからお試しください。',
    backToLogin: '← サインインに戻る',
    resetKicker: '✦ new password ✦',
    resetTitle: '新しいパスワードを設定',
    resetSubtitle: '8 文字以上で入力してください。',
    newPassword: '新しいパスワード',
    confirmPassword: '新しいパスワード（確認）',
    resetSubmit: 'パスワードを更新',
    resetSubmitting: '更新中…',
    resetDone: 'パスワードを更新しました。新しいパスワードでサインインしてください。',
    resetInvalid: 'この再設定リンクは無効か、有効期限が切れています。',
    requestNew: 'リンクを再送信',
    passwordTooShort: 'パスワードは 8 文字以上にしてください。',
    passwordMismatch: 'パスワードが一致しません。',
    genericError: '問題が発生しました。もう一度お試しください。',
    deviceKicker: '✦ connect a device ✦',
    deviceTitle: 'テレビでサインイン',
    deviceSubtitle: 'テレビ画面に表示されているコードを入力してください。',
    deviceCodeLabel: 'コード',
    deviceContinue: '続ける',
    deviceRequest: '{device} の {app} が leeguoo アカウントでのサインインを求めています。',
    deviceDefaultName: 'お使いのデバイス',
    deviceCompare: 'このコードが画面のコードと一致する場合のみ続けてください。',
    deviceSignedInAs: 'サインイン中のアカウント',
    deviceSwitch: 'アカウントを切り替える',
    deviceApprove: '許可',
    deviceApproving: '許可しています…',
    deviceDeny: '拒否',
    deviceApproved: '完了しました。{device} でサインインしました。デバイスに戻ってください。',
    deviceDenied: 'リクエストを拒否しました。サインインは行われていません。',
    deviceInvalid: 'コードが無効です。画面のコードを確認してもう一度お試しください。',
    deviceExpired: 'コードの有効期限が切れました。デバイスでもう一度サインインを開始してください。',
    deviceUsed: 'このコードはすでに使用されています。',
    deviceOtherCode: '別のコードを入力',
    membershipKicker: '✦ membership ✦',
    membershipTitle: 'メンバーシップ',
    membershipUnavailable: 'メンバーシップの購入はまだ受け付けていません。',
    membershipStatusTrial: '無料トライアル · 残り {days} 日（{date} まで）',
    membershipStatusMember: '{date} までメンバー',
    membershipStatusForever: 'メンバー',
    membershipStatusExpired: 'メンバーシップは {date} に終了しました',
    membershipStatusNone: 'まだメンバーではありません',
    membershipBuy: 'メンバーシップを購入',
    membershipRenew: 'メンバーシップを延長',
    membershipRedirecting: '爱发电を開いています…',
    membershipAfterPay: '支払い後、数秒で反映されます。アプリに戻って更新してください。',
    membershipRefresh: '状態を更新',
  },
  ko: {
    loginKicker: '✦ account center ✦',
    loginTitle: '다시 오신 것을 환영합니다',
    loginSubtitle: '계정에 로그인하세요.',
    loginSubtitleApp: 'leeguoo 계정으로 로그인하여 {app}(으)로 계속합니다.',
    registerKicker: '✦ new account ✦',
    registerTitle: '계정 만들기',
    registerSubtitle: '하나의 계정으로 모든 앱을 사용하세요.',
    registerSubtitleApp: '{app}에서 사용할 leeguoo 계정을 만듭니다.',
    apple: 'Apple로 로그인',
    appleSignup: 'Apple로 등록하기',
    google: 'Google로 계속하기',
    github: 'GitHub로 계속하기',
    googleSignup: 'Google로 가입',
    githubSignup: 'GitHub로 가입',
    or: '또는',
    email: '이메일',
    password: '비밀번호',
    forgot: '잊으셨나요?',
    showPassword: '비밀번호 표시',
    submitLogin: '로그인',
    submittingLogin: '로그인 중…',
    submitRegister: '계정 만들기',
    submittingRegister: '만드는 중…',
    noAccount: '계정이 없으신가요?',
    createOne: '만들기',
    haveAccount: '이미 계정이 있으신가요?',
    toLogin: '로그인 →',
    registered: '계정이 생성되었습니다. 로그인하세요.',
    signedIn: '로그인됨',
    footer: 'account.leeguoo.com · 안전한 로그인',
    accountExistsTitle: '이 이메일로 된 계정이 이미 있습니다',
    accountExistsBody: "{email}은(는) 이미 가입되어 있지만 이 {provider} 계정은 아직 연결되지 않았습니다. 보안을 위해 계정을 자동으로 연결하지 않습니다. 이전에 사용한 방법으로 로그인한 다음 '계정 → 로그인 방법'에서 {provider}을(를) 연결하세요.",
    accountExistsAction: '기존 방법으로 로그인',
    appleUnavailable: '지금은 Apple로 로그인을 사용할 수 없습니다.',
    wechat: 'WeChat으로 계속하기',
    wechatSignup: 'WeChat으로 가입',
    forgotKicker: '✦ password reset ✦',
    forgotTitle: '비밀번호를 잊으셨나요?',
    forgotSubtitle: '계정 이메일을 입력하면 비밀번호 재설정 링크를 보내 드립니다.',
    forgotSubmit: '재설정 링크 보내기',
    forgotSubmitting: '보내는 중…',
    forgotSent: '가입된 이메일이라면 재설정 링크를 보냈습니다(30분 동안 유효).',
    tooMany: '시도 횟수가 너무 많습니다. 잠시 후 다시 시도하세요.',
    backToLogin: '← 로그인으로 돌아가기',
    resetKicker: '✦ new password ✦',
    resetTitle: '새 비밀번호 설정',
    resetSubtitle: '8자 이상 입력하세요.',
    newPassword: '새 비밀번호',
    confirmPassword: '새 비밀번호 확인',
    resetSubmit: '비밀번호 변경',
    resetSubmitting: '변경 중…',
    resetDone: '비밀번호가 변경되었습니다. 새 비밀번호로 로그인하세요.',
    resetInvalid: '재설정 링크가 유효하지 않거나 만료되었습니다.',
    requestNew: '새 링크 요청',
    passwordTooShort: '비밀번호는 8자 이상이어야 합니다.',
    passwordMismatch: '비밀번호가 일치하지 않습니다.',
    genericError: '문제가 발생했습니다. 다시 시도하세요.',
    deviceKicker: '✦ connect a device ✦',
    deviceTitle: 'TV에서 로그인',
    deviceSubtitle: 'TV 화면에 표시된 코드를 입력하세요.',
    deviceCodeLabel: '코드',
    deviceContinue: '계속',
    deviceRequest: '{device}의 {app}에서 leeguoo 계정으로 로그인하려고 합니다.',
    deviceDefaultName: '기기',
    deviceCompare: '이 코드가 화면의 코드와 같을 때만 계속하세요.',
    deviceSignedInAs: '로그인한 계정',
    deviceSwitch: '계정 전환',
    deviceApprove: '허용',
    deviceApproving: '허용하는 중…',
    deviceDeny: '거부',
    deviceApproved: '완료되었습니다. {device}에서 로그인되었습니다. 이제 기기로 돌아가세요.',
    deviceDenied: '요청을 거부했습니다. 로그인되지 않았습니다.',
    deviceInvalid: '유효하지 않은 코드입니다. 화면의 코드를 확인하고 다시 시도하세요.',
    deviceExpired: '코드가 만료되었습니다. 기기에서 로그인을 다시 시작해 새 코드를 받으세요.',
    deviceUsed: '이미 사용된 코드입니다.',
    deviceOtherCode: '다른 코드 입력',
    membershipKicker: '✦ membership ✦',
    membershipTitle: '멤버십',
    membershipUnavailable: '멤버십 구매는 아직 열리지 않았습니다.',
    membershipStatusTrial: '무료 체험 · {days}일 남음 ({date}까지)',
    membershipStatusMember: '{date}까지 멤버',
    membershipStatusForever: '멤버',
    membershipStatusExpired: '멤버십이 {date}에 만료되었습니다',
    membershipStatusNone: '아직 멤버가 아닙니다',
    membershipBuy: '멤버십 구매',
    membershipRenew: '멤버십 연장',
    membershipRedirecting: '爱发电을 여는 중…',
    membershipAfterPay: '결제 후 몇 초 안에 적용됩니다. 앱으로 돌아가 새로고침하세요.',
    membershipRefresh: '상태 새로고침',
  },
}

export const formatCopy = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '')
