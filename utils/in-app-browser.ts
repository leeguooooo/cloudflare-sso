// Detect embedded / in-app browsers (WeChat, WeChat Work, QQ, …).
//
// Why this exists: Google permanently blocks Google OAuth inside embedded
// webviews with `403 disallowed_useragent` ("Use secure browsers" policy).
// We can't bypass Google, so the login page uses these helpers to warn the
// user and intercept the Google button before it dumps them on Google's
// error page. Email/password and GitHub keep working inside webviews.
//
// Every helper takes an optional UA string so the logic is pure and unit
// testable; on the client they default to navigator.userAgent.

const ua = (input?: string): string => {
  if (typeof input === 'string') return input
  if (typeof navigator !== 'undefined' && navigator.userAgent) return navigator.userAgent
  return ''
}

// WeChat in-app browser — the UA always carries `MicroMessenger`.
export const isWeChat = (input?: string): boolean => /MicroMessenger/i.test(ua(input))

// WeChat Work (企业微信) — carries `wxwork` in addition to MicroMessenger.
export const isWeChatWork = (input?: string): boolean => /wxwork/i.test(ua(input))

// QQ in-app browser — the embedded webview carries both a `QQ/<version>`
// token and `MQQBrowser`. Standalone QQ Browser has `MQQBrowser` but no
// bare `QQ/`, so requiring both avoids flagging the standalone browser.
export const isQQ = (input?: string): boolean => {
  const s = ua(input)
  return /\bQQ\/[\d.]+/i.test(s) && /MQQBrowser/i.test(s)
}

// Other well-known Chinese super-app webviews that also embed a webview.
const KNOWN_INAPP_RE = /(DingTalk|AlipayClient|Weibo|Lark|Feishu|baiduboxapp|Snapchat|Instagram|FBAN|FBAV|Line\/)/i

// Generic embedded-webview heuristics:
//  - Android System WebView advertises `; wv` in the UA.
//  - iOS WKWebViews used by native apps render with AppleWebKit + Mobile but,
//    unlike real browsers, omit the trailing `Safari` token (and aren't one of
//    the known standalone iOS browsers: Chrome=CriOS, Firefox=FxiOS,
//    Edge=EdgiOS, Opera=OPiOS). Real Mobile Safari keeps `Safari`, so this
//    never trips the normal Safari/Chrome flow.
const isAndroidWebView = (s: string): boolean => /; wv\)/i.test(s)
const isIosWebView = (s: string): boolean =>
  /(iPhone|iPod|iPad)/.test(s) &&
  /AppleWebKit/i.test(s) &&
  /Mobile/i.test(s) &&
  !/Safari/i.test(s) &&
  !/(CriOS|FxiOS|EdgiOS|OPiOS)/i.test(s)

// True for any embedded / in-app browser where we should warn before OAuth.
export const isInAppBrowser = (input?: string): boolean => {
  const s = ua(input)
  if (!s) return false
  return (
    isWeChat(s) ||
    isWeChatWork(s) ||
    isQQ(s) ||
    KNOWN_INAPP_RE.test(s) ||
    isAndroidWebView(s) ||
    isIosWebView(s)
  )
}

// Human-readable label for the banner ("微信" / "企业微信" / "QQ" / generic).
export const getInAppBrowserLabel = (input?: string): string => {
  const s = ua(input)
  if (isWeChatWork(s)) return '企业微信'
  if (isWeChat(s)) return '微信'
  if (isQQ(s)) return 'QQ'
  if (/DingTalk/i.test(s)) return '钉钉'
  if (/AlipayClient/i.test(s)) return '支付宝'
  if (/Weibo/i.test(s)) return '微博'
  if (/Lark|Feishu/i.test(s)) return '飞书'
  if (isInAppBrowser(s)) return 'App 内置浏览器'
  return ''
}
