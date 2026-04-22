import { join } from 'node:path'
import { presetVite } from '@nolebase/integrations/vitepress/vite'
import UnoCSS from 'unocss/vite'

import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'
import Inspect from 'vite-plugin-inspect'

const nolebaseVite = presetVite()

export default defineConfig({
  plugins: [
    nolebaseVite,
    Inspect(),
    Components({
      include: [/\.vue$/],
      // Do not exclude .md here to ensure VitePress can handle them
      dirs: '.vitepress/theme/components',
      dts: '.vitepress/components.d.ts',
    }),
    UnoCSS(),
  ],
  // Optimized dependencies for VitePress
  optimizeDeps: {
    exclude: [
      'vitepress',
    ],
  },
})
