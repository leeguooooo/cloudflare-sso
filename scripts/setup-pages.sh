#!/bin/bash
set -e

ACCOUNT_ID="3d050f54dac3fb90c344e3889ec45792"
PROJECT_NAME="cloudflare-sso"

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo "❌ CLOUDFLARE_API_TOKEN 环境变量未设置"
  echo ""
  echo "请先创建 API Token:"
  echo "1. 访问: https://dash.cloudflare.com/profile/api-tokens"
  echo "2. 点击 'Create Token'"
  echo "3. 使用 'Edit Cloudflare Workers' 模板，或自定义权限："
  echo "   - Account.Cloudflare Pages:Edit"
  echo "   - Account.D1:Edit"
  echo "4. 复制生成的 token"
  echo "5. 运行: export CLOUDFLARE_API_TOKEN=your_token"
  echo "6. 再次运行此脚本"
  exit 1
fi

echo "📋 读取 wrangler 配置..."
CONFIG_FILE="wrangler.account-test.toml"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "❌ 找不到配置文件: $CONFIG_FILE"
  exit 1
fi

# 提取 D1 数据库配置
DB_BINDING=$(grep -A 2 "\[\[d1_databases\]\]" "$CONFIG_FILE" | grep "binding" | cut -d'"' -f2)
DB_ID=$(grep -A 2 "\[\[d1_databases\]\]" "$CONFIG_FILE" | grep "database_id" | cut -d'"' -f2)

echo "✅ D1 数据库绑定: $DB_BINDING -> $DB_ID"

# 获取当前项目配置
echo "📥 获取当前项目配置..."
CURRENT_CONFIG=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT_NAME}" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json")

if echo "$CURRENT_CONFIG" | grep -q '"success":false'; then
  echo "❌ 获取项目配置失败:"
  echo "$CURRENT_CONFIG" | jq '.' 2>/dev/null || echo "$CURRENT_CONFIG"
  exit 1
fi

# 提取当前配置
PROD_CONFIG=$(echo "$CURRENT_CONFIG" | jq -r '.result.deployment_configs.production // {}')
PREVIEW_CONFIG=$(echo "$CURRENT_CONFIG" | jq -r '.result.deployment_configs.preview // {}')

# 准备更新配置
# 注意：环境变量需要通过 Cloudflare Dashboard 或单独的 API 设置
# 这里我们只设置 D1 数据库绑定

UPDATE_PAYLOAD=$(cat <<EOF
{
  "deployment_configs": {
    "production": {
      "d1_databases": {
        "${DB_BINDING}": "${DB_ID}"
      }
    },
    "preview": {
      "d1_databases": {
        "${DB_BINDING}": "${DB_ID}"
      }
    }
  }
}
EOF
)

echo "📤 更新项目配置..."
RESPONSE=$(curl -s -X PATCH \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT_NAME}" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$UPDATE_PAYLOAD")

if echo "$RESPONSE" | grep -q '"success":true'; then
  echo "✅ D1 数据库绑定配置成功！"
  echo ""
  echo "⚠️  注意：环境变量需要通过 Cloudflare Dashboard 手动设置："
  echo "   1. 访问: https://dash.cloudflare.com → Pages → ${PROJECT_NAME}"
  echo "   2. Settings → Environment variables"
  echo "   3. 添加以下变量（从 wrangler.account-test.toml 中复制）："
  echo "      - JWT_PRIVATE_KEY"
  echo "      - JWT_KID"
  echo "      - JWT_ISSUER"
  echo "      - PASSWORD_PEPPER"
  echo "      - 其他变量..."
  echo ""
  echo "✨ 配置完成后，重新部署: pnpm deploy:test"
else
  echo "❌ 更新配置失败:"
  echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
  exit 1
fi
