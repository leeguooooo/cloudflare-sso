import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url).pathname

/** Every wrangler config that is (or could be) committed: repo root and workers/*. */
const configFiles = () => {
  const files = readdirSync(root).filter((name) => /^wrangler.*\.toml$/.test(name)).map((name) => join(root, name))
  const workers = join(root, 'workers')
  try {
    for (const dir of readdirSync(workers)) {
      const candidate = join(workers, dir, 'wrangler.toml')
      try {
        if (statSync(candidate).isFile()) files.push(candidate)
      } catch {
        // no config in this worker
      }
    }
  } catch {
    // no workers directory
  }
  return files
}

describe('wrangler configs hold no secrets', () => {
  // The JWT signing key once leaked through a committed toml; secrets belong in `wrangler secret`.
  it.each(configFiles())('%s', (file) => {
    const text = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n')
    expect(text).not.toMatch(/PRIVATE KEY/)
    expect(text).not.toMatch(/GOCSPX-/)
    expect(text).not.toMatch(/^\s*[A-Z0-9_]*(SECRET|API_KEY|PEPPER_V2|PRIVATE_KEY)\s*=/m)
  })
})
