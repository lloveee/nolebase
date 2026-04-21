// Post-install patch: replace @nolebase/vitepress-plugin-thumbnail-hash with a noop stub
// This prevents OOM during builds by bypassing the image hash computation
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// Find the actual thumbnail-hash module location in node_modules
function findThumbnailHashModule(baseDir) {
  // Try scoped package first
  const scopedPath = resolve(baseDir, 'node_modules/@nolebase/vitepress-plugin-thumbnail-hash')
  if (existsSync(scopedPath))
    return scopedPath

  // Try nested inside @nolebase/integrations
  const nestedPath = resolve(baseDir, 'node_modules/@nolebase/integrations/node_modules/@nolebase/vitepress-plugin-thumbnail-hash')
  if (existsSync(nestedPath))
    return nestedPath

  return null
}

const stubCode = `// PATCHED: thumbnail-hash replaced by postinstall patch-stub
// Returns a noop Vite plugin to prevent image hash computation and OOM
export default function thumbnailHashStub() {
  return {
    name: '@nolebase/vitepress-plugin-thumbnail-hash-stub',
    enforce: 'pre',
    transform() { return null; }
  }
}
`

const modulePath = findThumbnailHashModule(__dirname)

if (!modulePath) {
  console.warn('[patch-thumb-hash] Module not found, skipping patch')
  process.exit(0)
}

const indexPath = join(modulePath, 'index.js')
const existingContent = existsSync(indexPath) ? readFileSync(indexPath, 'utf-8') : ''

if (existingContent.includes('PATCHED')) {
  console.log('[patch-thumb-hash] Already patched, skipping')
}
else {
  writeFileSync(indexPath, stubCode, 'utf-8')
  console.log('[patch-thumb-hash] Patched thumbnail-hash module at', modulePath)
}
