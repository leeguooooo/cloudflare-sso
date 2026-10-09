<template>
  <div class="section-stack">
    <!-- merge proposal: the provider just linked already belonged to another account -->
    <div v-if="mergeId" class="stack-block merge-block">
      <h3>合并账号</h3>
      <p v-if="mergeLoading" class="block-hint">正在读取另一个账号的信息…</p>
      <template v-else-if="merge">
        <template v-if="merge.status === 'done'">
          <p class="block-hint">两个账号已经合并，之后用任意一种登录方式都会进入这个账号。</p>
          <div class="inline-actions"><UiButton variant="ghost" size="sm" @click="closeMerge">好的</UiButton></div>
        </template>
        <template v-else-if="!merge.actionable">
          <p class="block-hint">{{ merge.status === 'refused' ? (merge.error || '无法合并这两个账号。') : '这个合并请求已经过期。如需合并，请重新绑定该登录方式。' }}</p>
          <div class="inline-actions"><UiButton variant="ghost" size="sm" @click="closeMerge">关闭</UiButton></div>
        </template>
        <template v-else>
          <p class="block-hint">
            你刚刚验证的 {{ providerName(merge.provider) }} 账号已经属于另一个 leeguoo 账号
            <strong>{{ merge.other?.email }}</strong>（创建于 {{ formatDate(merge.other?.created_at) }}）。
            确认这两个账号都是你的，就可以把它合并到当前账号 <strong>{{ merge.current?.email }}</strong>。
          </p>
          <ul class="merge-list">
            <li>另一个账号的登录方式会转到当前账号：{{ otherMethodsText }}。</li>
            <li>它在已连接应用中的数据会合并到当前账号<span v-if="appDataText">（{{ appDataText }}）</span>；同名分组会合并成一个，收藏和已删除记录保持原样。</li>
            <li v-if="merge.password_note === 'adopt_other_password'">当前账号还没有密码：合并后可以用 {{ merge.other?.email }} 和它原来的密码登录这个账号。</li>
            <li v-else-if="merge.password_note === 'other_password_stops'">两个账号都有密码：合并后 {{ merge.other?.email }} 的邮箱密码登录会停用，请用当前账号的方式登录。</li>
            <li>另一个账号随后会被删除，并在所有设备上退出登录。此操作无法撤销。</li>
          </ul>
          <p v-for="(app, index) in refusedApps" :key="index" class="merge-refusal">{{ app.message }}</p>
          <p v-if="merge.status === 'failed' && merge.error" class="merge-refusal">上次合并没有完成：{{ merge.error }}。可以重试，已完成的部分不会重复执行。</p>
          <div class="inline-actions">
            <UiButton variant="primary" :loading="merging" :disabled="refusedApps.length > 0" @click="confirmMerge">
              {{ merge.status === 'failed' ? '重试合并' : '确认合并' }}
            </UiButton>
            <UiButton variant="ghost" :disabled="merging" @click="cancelMerge">取消</UiButton>
          </div>
        </template>
      </template>
    </div>

    <div class="stack-block">
      <h3>登录方式</h3>
      <p class="block-hint">下面任意一种方式都能登录这个账号，至少要保留一种。</p>
      <div v-if="methods && !methods.recent_auth" class="reauth-row">
        <span>为了安全，绑定、解绑、设置密码前需要你在 15 分钟内登录过。</span>
        <UiButton variant="ghost" size="sm" @click="reauthenticate()">重新验证身份</UiButton>
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
              :title="row.isLast ? '这是唯一的登录方式，不能移除' : ''"
              :loading="unlinkingProvider === row.key"
              @click="unlinkIdentity(row)"
            >
              解绑
            </UiButton>
            <UiButton v-else-if="row.action === 'link'" variant="primary" size="sm" @click="startLinkProvider(row.provider)">
              绑定
            </UiButton>
            <UiButton v-else-if="row.action === 'password'" variant="ghost" size="sm" @click="goSection('password')">
              {{ methods?.has_password ? '修改密码' : '设置密码' }}
            </UiButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const {
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
