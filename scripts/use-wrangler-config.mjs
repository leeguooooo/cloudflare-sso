#!/usr/bin/env node
import { cpSync, existsSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const [, , envName] = process.argv

if (!envName) {
  console.error('Usage: node scripts/use-wrangler-config.mjs <env>')
  process.exit(1)
}

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const template = envName.endsWith('.toml')
  ? envName
  : `wrangler.account-${envName}.toml`
const source = resolve(projectRoot, template)
const destination = resolve(projectRoot, 'wrangler.toml')

if (!existsSync(source)) {
  console.error(`Config file not found: ${template}`)
  process.exit(1)
}

cpSync(source, destination)
console.log(`[wrangler-config] Applied ${basename(source)} -> wrangler.toml`)
