import { presetVite } from '@nolebase/integrations/vitepress/vite'

const nolebase = presetVite({
  thumbnailHash: false,
})

const plugins = nolebase.plugins()
console.log('[DEBUG] Total plugins:', plugins.length)
for (let i = 0; i < plugins.length; i++) {
  const p = plugins[i]
  const name = typeof p === 'object' && p.name ? p.name : `index:${i}`
  console.log(`[DEBUG] Plugin ${i}:`, name)
}
