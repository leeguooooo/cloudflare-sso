import { describe, expect, it } from 'vitest'
import {
  getInAppBrowserLabel,
  isInAppBrowser,
  isQQ,
  isWeChat,
  isWeChatWork,
} from '../../utils/in-app-browser'

// Representative real-world user-agent strings.
const UA = {
  wechatIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40(0x18002831) NetType/WIFI Language/zh_CN',
  wechatAndroid:
    'Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/114.0.0.0 Mobile Safari/537.36 MMWEBID/1234 MicroMessenger/8.0.40.2420(0x28002837) WeChat/arm64 NetType/WIFI Language/zh_CN',
  wechatWork:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/7.0.1 wxwork/4.1.6 ColorScheme/Light',
  qq:
    'Mozilla/5.0 (Linux; U; Android 12; zh-cn; M2012K11AC Build/SP1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/107.0.0.0 MQQBrowser/6.2 Mobile Safari/537.36 V1_AND_SQ_8.9.50 QQ/8.9.50.10095 NetType/WIFI',
  // Standalone QQ Browser (not an in-app webview) — has MQQBrowser but no bare QQ/.
  qqBrowser:
    'Mozilla/5.0 (Linux; U; Android 12; zh-CN; M2012K11AC Build/SP1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/86.0.4240.99 MQQBrowser/13.1 Mobile Safari/537.36',
  // Normal browsers — must NOT be flagged.
  chromeDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  safariIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
  chromeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
}

describe('isWeChat', () => {
  it('detects WeChat on iOS and Android', () => {
    expect(isWeChat(UA.wechatIos)).toBe(true)
    expect(isWeChat(UA.wechatAndroid)).toBe(true)
  })
  it('is false for normal browsers', () => {
    expect(isWeChat(UA.safariIos)).toBe(false)
    expect(isWeChat(UA.chromeDesktop)).toBe(false)
  })
})

describe('isWeChatWork', () => {
  it('detects WeChat Work', () => {
    expect(isWeChatWork(UA.wechatWork)).toBe(true)
  })
  it('is false for plain WeChat', () => {
    expect(isWeChatWork(UA.wechatIos)).toBe(false)
  })
})

describe('isQQ', () => {
  it('detects the QQ in-app webview', () => {
    expect(isQQ(UA.qq)).toBe(true)
  })
  it('does not flag the standalone QQ Browser', () => {
    expect(isQQ(UA.qqBrowser)).toBe(false)
  })
})

describe('isInAppBrowser', () => {
  it('is true for WeChat / WeChat Work / QQ', () => {
    expect(isInAppBrowser(UA.wechatIos)).toBe(true)
    expect(isInAppBrowser(UA.wechatAndroid)).toBe(true)
    expect(isInAppBrowser(UA.wechatWork)).toBe(true)
    expect(isInAppBrowser(UA.qq)).toBe(true)
  })
  it('is false for normal browsers (Google login must still work)', () => {
    expect(isInAppBrowser(UA.chromeDesktop)).toBe(false)
    expect(isInAppBrowser(UA.safariIos)).toBe(false)
    expect(isInAppBrowser(UA.chromeIos)).toBe(false)
    expect(isInAppBrowser(UA.chromeAndroid)).toBe(false)
    expect(isInAppBrowser(UA.qqBrowser)).toBe(false)
  })
  it('is false for an empty UA', () => {
    expect(isInAppBrowser('')).toBe(false)
  })
})

describe('getInAppBrowserLabel', () => {
  it('returns localized labels', () => {
    expect(getInAppBrowserLabel(UA.wechatIos)).toBe('微信')
    expect(getInAppBrowserLabel(UA.wechatWork)).toBe('企业微信')
    expect(getInAppBrowserLabel(UA.qq)).toBe('QQ')
  })
  it('returns empty string for normal browsers', () => {
    expect(getInAppBrowserLabel(UA.safariIos)).toBe('')
    expect(getInAppBrowserLabel(UA.chromeDesktop)).toBe('')
  })
})
