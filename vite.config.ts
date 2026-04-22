import { join } from 'node:path'
import { presetVite } from '@nolebase/integrations/vitepress/vite'
import { 
  GitChangelog, 
  GitChangelogMarkdownSection, 
} from '@nolebase/vitepress-plugin-git-changelog/vite'
import { 
  PageProperties, 
  PagePropertiesMarkdownSection, 
} from '@nolebase/vitepress-plugin-page-properties/vite'
import UnoCSS from 'unocss/vite'
import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'
import Inspect from 'vite-plugin-inspect'

const nolebaseVite = presetVite()

export default defineConfig({
  plugins: [
    {
      name: 'pdf-to-md-desensitizer',
      transform(code, id) {
        if (id.endsWith('.md') && id.replace(/\\/g, '/').includes('repo/refer')) {
          // Automatic fix for PDF-to-MD artifacts:
          // 1. Escape backslashes to shield LaTeX from Vue compiler
          // 2. Escape angle brackets to shield C++ templates from Vue compiler
          // 3. Wrap everything in v-pre to ensure static rendering
          const desensitized = code
            .replace(/\\/g, '&#92;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\$/g, '&#36;')
          
          return {
            code: `\n\n<div v-pre>\n\n${desensitized}\n\n</div>\n`,
            map: null
          }
        }
      },
      enforce: 'pre'
    },
    GitChangelog({ repoPath: '.' }),
    GitChangelogMarkdownSection(),
    PageProperties(),
    PagePropertiesMarkdownSection(),
    nolebaseVite,
    Inspect(),
    Components({
      include: [/\.vue$/],
      dirs: '.vitepress/theme/components',
      dts: '.vitepress/components.d.ts',
    }),
    UnoCSS(),
  ],
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            return 'vendor'
          }
        }
      }
    }
  },
  ssr: {
    noExternal: [
      '@nolebase/integrations',
      '@nolebase/vitepress-plugin-enhanced-readabilities',
      '@nolebase/vitepress-plugin-highlight-targeted-heading',
      '@nolebase/vitepress-plugin-git-changelog',
      '@nolebase/vitepress-plugin-page-properties',
    ],
  },
})
