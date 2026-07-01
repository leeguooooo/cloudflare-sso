# Account Center QA Checklist

## Scope
- Page: `/account`
- Date: 2026-03-03
- Note: WeChat OAuth is TODO (not enabled)

## Pre-check
1. Confirm D1 binding `DB` is configured in runtime.
2. Confirm OAuth env is configured for GitHub/Google if testing third-party link.
3. Sign in with a normal user account and enter `/account`.

## Navigation & Search
1. Click all left nav items and verify section title matches route query `section`.
2. Verify top-right `apps` menu opens and each menu item is reachable.
3. Search for `密码/设备/邮箱` and verify jump target is correct.
4. Verify quick actions map correctly:
- `我的密码` -> `section=password`
- `设备` -> `section=security&panel=sessions`
- `密码管理工具` -> `section=password&panel=manager`
- `我的活动记录` -> `section=security&panel=activity`
- `邮箱` -> `section=profile&panel=email`

## Profile
1. Update display name and locale in `个人信息`.
2. Refresh page and verify values persist.
3. Verify audit log contains `account.profile.update`.

## Security
1. In `安全性与登录`, verify session list and recent activity are visible.
2. Revoke a non-current session and verify status changes to revoked.
3. Revoke current session and verify user is redirected to `/login`.

## Password
1. Change password with valid current password.
2. Verify success message is shown.
3. Verify other sessions are revoked.
4. Verify old password cannot log in and new password can.

## Linked Accounts
1. Verify Google/GitHub show bind/unbind actions.
2. Bind provider and verify callback returns to `section=linked` with success notice.
3. Unbind provider and verify list refreshes.
4. Verify WeChat shows TODO state and cannot be triggered.

## Privacy
1. Open `数据和隐私设置` and click `下载数据导出`.
2. Verify downloaded JSON includes profile/sessions/activity/billing.

## Billing & Sharing
1. In `用户和分享`, verify app session summary is visible.
2. In `付费和订阅`, verify subscriptions and active entitlement chips render correctly.

## Public pages & login footer
1. Open `/help`, `/privacy`, `/terms`, `/about` and verify content is non-placeholder.
2. Open `/login` and `/register`, verify footer links route correctly.

## Pass Criteria
- All items above pass without JS errors.
- No placeholder texts like `-`, `开发中`, `待接入` (except WeChat TODO).
