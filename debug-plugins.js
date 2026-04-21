import { presetVite } from '@nolebase/integrations/vitepress/vite'

const nolebase = presetVite({
  thumbnailHash: false,
})

const plugins = nolebase.plugins()
console.log('Plugin count:', plugins.length)
for (const p of plugins) {
  const name = typeof p === 'object' && p.name ? p.name : String(p)
  console.log('-', name.substring(0, 80))
}
