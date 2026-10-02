# Account Center QA Checklist

## Scope
- Page: `/account`
- Date: 2026-10-02
- Note: WeChat sign-in is not supported (no button is shown)

## Pre-check
1. Confirm D1 binding `DB` is configured in runtime.
2. Confirm OAuth env is configured for GitHub/Google if testing third-party link.
3. Sign in with a normal user account and enter `/account`.

## Navigation & Search
1. Click all left nav items and verify section title matches route query `section`.
2. Verify the top-right `⋮` admin menu is shown only for accounts with the `admin` role, and each item is reachable.
3. Search for `密码/设备/订阅` and verify jump target is correct.
4. Verify quick actions map correctly:
- `我的密码` -> `section=password`
- `设备` -> `section=security&panel=sessions`
- `我的活动记录` -> `section=security&panel=activity`

## Profile
1. Update display name and locale in `个人信息`.
2. Refresh page and verify values persist.
3. Verify audit log contains `account.profile.update`.

## Security
1. In `安全性与登录`, verify session list and recent activity are visible.
2. Revoke a non-current session and verify status changes to revoked.
3. Revoke current session and verify user is redirected to `/login`.
4. With 2+ other active sessions, click `退出其他所有设备`; verify all but the current one become revoked and you stay signed in.

## Password
1. Change password with valid current password.
2. Verify success message is shown.
3. Verify other sessions are revoked.
4. Verify old password cannot log in and new password can.

## Linked Accounts
1. Verify Apple/Google/GitHub show bind/unbind actions.
2. Bind provider and verify callback returns to `section=linked` with success notice.
3. Unbind provider and verify list refreshes.

## Privacy
1. Open `数据和隐私设置` and click `下载账号信息 (JSON)`.
2. Verify downloaded JSON includes profile/sessions/activity/billing.
3. Click `删除账号…` on an admin account: verify the refusal message is shown and nothing is deleted.
4. On a normal account signed in more than 15 minutes ago: verify the re-login prompt, and that `重新登录` returns to `section=privacy`.
5. After a fresh sign-in: the delete button stays disabled until the exact email is typed; confirming deletes the account and lands on `/login`; the old password no longer works.

## Billing & Sharing
1. In `用户和分享`, verify app session summary is visible.
2. Click `撤销访问` on an app other than the current one; verify its sessions are revoked and the button disappears.
2. In `付费和订阅`, verify subscriptions and active entitlement chips render correctly.

## Public pages & login footer
1. Open `/help`, `/privacy`, `/terms`, `/about` and verify content is non-placeholder.
2. On `/login`, `忘记了？` opens `/help#password` (not the register page).
3. Open `/login` and `/register`, verify footer links route correctly.

## Pass Criteria
- All items above pass without JS errors.
- No placeholder texts like `-`, `开发中`, `待接入`, `TODO`.
