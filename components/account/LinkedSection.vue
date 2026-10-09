<template>
  <div class="section-stack">
    <!-- merge proposal: the provider just linked already belonged to another account -->
    <div v-if="mergeId" class="stack-block merge-block">
      <h3>{{ tr('合并账号', 'Merge accounts') }}</h3>
      <p v-if="mergeLoading" class="block-hint">{{ tr('正在读取另一个账号的信息…', 'Loading the other account…') }}</p>
      <template v-else-if="merge">
        <template v-if="merge.status === 'done'">
          <p class="block-hint">{{ tr('两个账号已经合并，之后用任意一种登录方式都会进入这个账号。', 'The accounts are merged. Any of your sign-in methods now opens this account.') }}</p>
          <div class="inline-actions"><UiButton variant="ghost" size="sm" @click="closeMerge">{{ tr('好的', 'OK') }}</UiButton></div>
        </template>
        <template v-else-if="!merge.actionable">
          <p class="block-hint">{{ merge.status === 'refused' ? (merge.error || tr('无法合并这两个账号。', 'These accounts can’t be merged.')) : tr('这个合并请求已经过期。如需合并，请重新绑定该登录方式。', 'This merge request has expired. To merge, link that sign-in method again.') }}</p>
          <div class="inline-actions"><UiButton variant="ghost" size="sm" @click="closeMerge">{{ tr('关闭', 'Close') }}</UiButton></div>
        </template>
        <template v-else>
          <p class="block-hint">
            {{ tr(`你刚刚验证的 ${providerName(merge.provider)} 账号已经属于另一个 leeguoo 账号`, `The ${providerName(merge.provider)} account you just verified already belongs to another leeguoo account`) }}
            <strong>{{ merge.other?.email }}</strong>{{ tr(`（创建于 ${formatDate(merge.other?.created_at)}）。`, ` (created ${formatDate(merge.other?.created_at)}).`) }}
            {{ tr('确认这两个账号都是你的，就可以把它合并到当前账号', 'If both accounts are yours, you can merge it into your current account') }} <strong>{{ merge.current?.email }}</strong>{{ tr('。', '.') }}
          </p>
          <ul class="merge-list">
            <li>{{ tr(`另一个账号的登录方式会转到当前账号：${otherMethodsText}。`, `The other account’s sign-in methods move to your current account: ${otherMethodsText}.`) }}</li>
            <li>{{ tr('它在已连接应用中的数据会合并到当前账号', 'Its data in connected apps is merged into your current account') }}<span v-if="appDataText">{{ tr(`（${appDataText}）`, ` (${appDataText})`) }}</span>{{ tr('；同名分组会合并成一个，收藏和已删除记录保持原样。', '. Groups with the same name become one; favorites and deleted items stay as they are.') }}</li>
            <li v-if="merge.password_note === 'adopt_other_password'">{{ tr(`当前账号还没有密码：合并后可以用 ${merge.other?.email} 和它原来的密码登录这个账号。`, `Your current account has no password: after the merge you can sign in to it with ${merge.other?.email} and its existing password.`) }}</li>
            <li v-else-if="merge.password_note === 'other_password_stops'">{{ tr(`两个账号都有密码：合并后 ${merge.other?.email} 的邮箱密码登录会停用，请用当前账号的方式登录。`, `Both accounts have a password: after the merge, email and password sign-in for ${merge.other?.email} stops working. Use your current account’s sign-in methods.`) }}</li>
            <li>{{ tr('另一个账号随后会被删除，并在所有设备上退出登录。此操作无法撤销。', 'The other account is then deleted and signed out on all devices. This can’t be undone.') }}</li>
          </ul>
          <p v-for="(app, index) in refusedApps" :key="index" class="merge-refusal">{{ app.message }}</p>
          <p v-if="merge.status === 'failed' && merge.error" class="merge-refusal">{{ tr(`上次合并没有完成：${merge.error}。可以重试，已完成的部分不会重复执行。`, `The last merge didn’t finish: ${merge.error}. You can retry; finished steps won’t run again.`) }}</p>
          <div class="inline-actions">
            <UiButton variant="primary" :loading="merging" :disabled="refusedApps.length > 0" @click="confirmMerge">
              {{ merge.status === 'failed' ? tr('重试合并', 'Retry merge') : tr('确认合并', 'Merge accounts') }}
            </UiButton>
            <UiButton variant="ghost" :disabled="merging" @click="cancelMerge">{{ tr('取消', 'Cancel') }}</UiButton>
          </div>
        </template>
      </template>
    </div>

    <div class="stack-block">
      <h3>{{ tr('登录方式', 'Sign-in methods') }}</h3>
      <p class="block-hint">{{ tr('下面任意一种方式都能登录这个账号，至少要保留一种。', 'Any of these methods signs you in to this account. Keep at least one.') }}</p>
      <div v-if="methods && !methods.recent_auth" class="reauth-row">
        <span>{{ tr('为了安全，绑定、解绑、设置密码前需要你在 15 分钟内登录过。', 'For your security, you need to have signed in within the last 15 minutes to link, unlink or set a password.') }}</span>
        <UiButton variant="ghost" size="sm" @click="reauthenticate()">{{ tr('重新验证身份', 'Verify it’s you') }}</UiButton>
      </div>
      <div class="list-wrap">
        <div v-for="row in methodRows" :key="row.key" class="list-item">
          <div>
            <strong>{{ row.label }}</strong>
            <p>{{ row.detail }}</p>
          </div>
          <div class="list-actions">
            <UiButton
              v-if="row.action === 'unlink'"
              variant="ghost"
              size="sm"
              :disabled="row.isLast"
              :title="row.isLast ? tr('这是唯一的登录方式，不能移除', 'This is your only sign-in method and can’t be removed') : ''"
              :loading="unlinkingProvider === row.key"
              @click="unlinkIdentity(row)"
            >
              {{ tr('解绑', 'Unlink') }}
            </UiButton>
            <UiButton v-else-if="row.action === 'link'" variant="primary" size="sm" @click="startLinkProvider(row.provider)">
              {{ tr('绑定', 'Link') }}
            </UiButton>
            <UiButton v-else-if="row.action === 'password'" variant="ghost" size="sm" @click="goSection('password')">
              {{ methods?.has_password ? tr('修改密码', 'Change password') : tr('设置密码', 'Set password') }}
            </UiButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const {
  tr,
  loading,
  unlinkingProvider,
  providerName,
  methods,
  merge,
  mergeLoading,
  merging,
  mergeId,
  methodRows,
  otherMethodsText,
  appDataText,
  refusedApps,
  formatDate,
  closeMerge,
  confirmMerge,
  cancelMerge,
  reauthenticate,
  goSection,
  startLinkProvider,
  unlinkIdentity,
} = useAccountCenter()
</script>
