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
}

type QueryLike = Record<string, unknown>

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** Only same-origin relative paths are honoured as `continue` targets. */
export const safeContinuePath = (raw: unknown): string => {
  const value = typeof raw === 'string' ? raw : ''
  if (!value.startsWith('/') || value.startsWith('//')) return ''
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
  },
}

export const formatCopy = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '')
