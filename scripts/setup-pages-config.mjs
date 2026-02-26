#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')

const ACCOUNT_ID = '3d050f54dac3fb90c344e3889ec45792'
const PROJECT_NAME = 'cloudflare-sso'

// 解析 TOML 配置
function parseTomlConfig(configContent) {
  const vars = {}
  const d1Databases = []
  
  let inVars = false
  let inD1 = false
  let currentD1 = {}
  let inJwtKey = false
  let jwtKeyLines = []
  
  for (const line of configContent.split('\n')) {
    const trimmed = line.trim()
    
    if (trimmed === '[vars]') {
      inVars = true
      inD1 = false
      continue
    }
    
    if (trimmed.startsWith('[[d1_databases]]')) {
      if (currentD1.binding) {
        d1Databases.push(currentD1)
      }
      inD1 = true
      inVars = false
      currentD1 = {}
      continue
    }
    
    if (inVars && trimmed.includes('=')) {
      const [key, ...valueParts] = trimmed.split('=')
      const keyName = key.trim()
      let value = valueParts.join('=').trim()
      
      if (keyName === 'JWT_PRIVATE_KEY') {
        if (value === '"""') {
          inJwtKey = true
          jwtKeyLines = []
          continue
        }
      }
      
      if (inJwtKey) {
        if (trimmed === '"""') {
          vars[keyName] = jwtKeyLines.join('\n')
          inJwtKey = false
          jwtKeyLines = []
        } else {
          jwtKeyLines.push(line)
        }
        continue
      }
      
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1)
      }
      vars[keyName] = value
    }
    
    if (inD1 && trimmed.includes('=')) {
      const [key, value] = trimmed.split('=')
      const keyName = key.trim()
      let val = value.trim()
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1)
      }
      currentD1[keyName] = val
    }
  }
  
  if (currentD1.binding) {
    d1Databases.push(currentD1)
  }
  
  return { vars, d1Databases }
}

function getWranglerConfig() {
  try {
    const configPath = resolve(projectRoot, 'wrangler.account-prod.toml')
    const configContent = readFileSync(configPath, 'utf-8')
    return parseTomlConfig(configContent)
  } catch (error) {
    console.error('Error reading wrangler config:', error)
    process.exit(1)
  }
}

async function getApiToken() {
  // 从环境变量获取
  if (process.env.CLOUDFLARE_API_TOKEN) {
    return process.env.CLOUDFLARE_API_TOKEN
  }
  
  // 尝试从 wrangler 获取（需要用户已登录）
  try {
    // wrangler 使用 OAuth，我们需要用户提供 API token
    console.error('❌ CLOUDFLARE_API_TOKEN environment variable is required')
    console.error('\n📝 To get an API token:')
    console.error('   1. Visit https://dash.cloudflare.com/profile/api-tokens')
    console.error('   2. Create a token with "Cloudflare Pages:Edit" permission')
    console.error('   3. Run: export CLOUDFLARE_API_TOKEN=your_token')
    console.error('   4. Run this script again')
    process.exit(1)
  } catch (error) {
    console.error('Error getting API token:', error)
    process.exit(1)
  }
}

async function updatePagesProject(apiToken, vars, d1Databases) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT_NAME}`
  
  // 获取当前项目配置
  console.log('📥 Fetching current project configuration...')
  const getResponse = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
  })
  
  if (!getResponse.ok) {
    const error = await getResponse.text()
    throw new Error(`Failed to get project: ${getResponse.status} ${error}`)
  }
  
  const project = await getResponse.json()
  if (!project.success) {
    throw new Error(`API error: ${JSON.stringify(project.errors)}`)
  }
  
  const currentConfig = project.result?.deployment_configs || {
    production: {},
  }
  
  // 准备 D1 数据库绑定
  const d1Bindings = {}
  for (const db of d1Databases) {
    d1Bindings[db.binding] = db.database_id
  }
  
  // 准备环境变量（转换为 Pages API 格式）
  const envVars = {}
  for (const [key, value] of Object.entries(vars)) {
    envVars[key] = { value, type: 'secret_text' }
  }
  
  // 更新配置
  const deploymentConfigs = {
    production: {
      ...currentConfig.production,
      env_vars: {
        ...(currentConfig.production?.env_vars || {}),
        ...envVars,
      },
      d1_databases: {
        ...(currentConfig.production?.d1_databases || {}),
        ...d1Bindings,
      },
    },
  }
  
  console.log('📤 Updating project configuration...')
  const updateResponse = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      deployment_configs: deploymentConfigs,
    }),
  })
  
  if (!updateResponse.ok) {
    const error = await updateResponse.text()
    throw new Error(`Failed to update project: ${updateResponse.status} ${error}`)
  }
  
  const result = await updateResponse.json()
  if (!result.success) {
    throw new Error(`API error: ${JSON.stringify(result.errors)}`)
  }
  
  return result
}

async function main() {
  console.log('📋 Reading wrangler configuration...')
  const { vars, d1Databases } = getWranglerConfig()
  
  console.log(`✅ Found ${Object.keys(vars).length} environment variables`)
  console.log(`   - ${Object.keys(vars).join(', ')}`)
  console.log(`✅ Found ${d1Databases.length} D1 database bindings`)
  console.log(`   - ${d1Databases.map(db => `${db.binding} -> ${db.database_name}`).join(', ')}`)
  
  console.log('\n🔑 Getting API token...')
  const apiToken = await getApiToken()
  
  console.log('\n🚀 Updating Cloudflare Pages project configuration...')
  try {
    await updatePagesProject(apiToken, vars, d1Databases)
    console.log('\n✅ Successfully updated project configuration!')
    console.log('\n📝 Configuration applied to:')
    console.log('   - Production environment')
    console.log('\n✨ Next steps:')
    console.log('   1. Redeploy your application: pnpm deploy:prod')
    console.log('   2. Test the login endpoint')
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    if (error.message.includes('401') || error.message.includes('403')) {
      console.error('\n💡 Make sure your API token has "Cloudflare Pages:Edit" permission')
    }
    process.exit(1)
  }
}

main().catch(console.error)
