// Post-install patch: replace thumbnail-hash related modules with noop stubs
// This prevents OOM during builds by bypassing image hash computation
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

function findModule(baseDir, moduleName) {
  const paths = [
    resolve(baseDir, 'node_modules', moduleName),
    resolve(baseDir, 'node_modules/@nolebase/integrations/node_modules', moduleName),
    resolve(baseDir, 'node_modules/.pnpm'),
  ]
  // Glob for pnpm nested paths
  try {
    const { sync } = require('tinyglobby')
    const matches = sync(`@nolebase+${moduleName.replace('@', '').replace('/', '+')}*/node_modules/${moduleName}`, {
      cwd: resolve(baseDir, 'node_modules/.pnpm'),
      onlyDirectories: true,
    })
    if (matches.length > 0)
      return matches[0]
  }
  catch {}

  for (const p of paths) {
    if (existsSync(p))
      return p
  }
  return null
}

function patchFile(filePath, marker, replacement) {
  if (!existsSync(filePath))
    return false
  const content = readFileSync(filePath, 'utf-8')
  if (content.includes(marker))
    return false
  writeFileSync(filePath, replacement, 'utf-8')
  return true
}

// 1. Stub the Vite plugin (thumbnail-hash)
const thumbHashStub = `// PATCHED: thumbnail-hash replaced by postinstall stub
// Prevents OOM by bypassing image hash computation
export default function thumbnailHashStub() {
  return {
    name: '@nolebase/vitepress-plugin-thumbnail-hash-stub',
    enforce: 'pre',
    transform() { return null; }
  }
}
`
const thumbHashModule = findModule(__dirname, '@nolebase/vitepress-plugin-thumbnail-hash')
if (thumbHashModule) {
  const indexPath = join(thumbHashModule, 'index.js')
  if (patchFile(indexPath, 'PATCHED', thumbHashStub)) {
    console.log(`[patch] thumbnail-hash (vite plugin): patched ${indexPath}`)
  }
  else {
    console.log(`[patch] thumbnail-hash (vite plugin): already patched or not found, skipping`)
  }
}
else {
  console.warn('[patch] thumbnail-hash (vite plugin): module not found')
}

// 2. Patch markdown-it-unlazy-img dist to make ensureThumbhashMap return empty Map on error
const unlazyModule = findModule(__dirname, '@nolebase/markdown-it-unlazy-img')
if (unlazyModule) {
  // Find the actual dist/index.mjs
  const distPath = join(unlazyModule, 'dist', 'index.mjs')
  if (existsSync(distPath)) {
    const marker = '// PATCHED: unlazy-img patched by postinstall'
    let content = readFileSync(distPath, 'utf-8')
    if (content.includes(marker)) {
      console.log(`[patch] markdown-it-unlazy-img: already patched, skipping`)
    }
    else {
      // The key issue: ensureThumbhashMap calls globSync, then readFileSync,
      // and THROWS when no map.json found. We need to catch that error and return empty Map.
      // Replace the throw statement with a return of empty Map
      content = content.replace(
        /throw new Error\(['"`]No thumbhash map file found[\s\S]*?\`\)\)/m,
        '{ console.warn("[patch] unlazy-img: no thumbhash map found, using empty map"); return new Map(); }'
      )
      content = marker + '\n' + content
      writeFileSync(distPath, content, 'utf-8')
      console.log(`[patch] markdown-it-unlazy-img: patched ${distPath}`)
    }
  }
  else {
    console.warn(`[patch] markdown-it-unlazy-img: dist/index.mjs not found at ${distPath}, searching...`)
    // Try to find it
    try {
      const { sync } = require('tinyglobby')
      const matches = sync('**/dist/index.mjs', { cwd: unlazyModule, onlyFiles: true })
      if (matches.length > 0) {
        const foundPath = join(unlazyModule, matches[0])
        let content = readFileSync(foundPath, 'utf-8')
        if (!content.includes('PATCHED')) {
          content = content.replace(
            /throw new Error\(['"`]No thumbhash map file found[\s\S]*?\`\)\)/m,
            '{ console.warn("[patch] unlazy-img: no thumbhash map found, using empty map"); return new Map(); }'
          )
          content = '// PATCHED: unlazy-img patched by postinstall\n' + content
          writeFileSync(foundPath, content, 'utf-8')
          console.log(`[patch] markdown-it-unlazy-img: patched ${foundPath}`)
        }
      }
    }
    catch (e) {
      console.warn(`[patch] markdown-it-unlazy-img: could not find dist file: ${e.message}`)
    }
  }
}
else {
  console.warn('[patch] markdown-it-unlazy-img: module not found')
}
