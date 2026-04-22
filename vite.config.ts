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
      name: 'pdf-to-md-static-shield',
      transform(code, id) {
        if (id.endsWith('.md') && id.replace(/\\/g, '/').includes('repo/refer')) {
          // Shield the messy PDF content from Vue compiler
          const escaped = code
            .replace(/\\/g, '&#92;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\$/g, '&#36;')
            .replace(/\{/g, '&#123;')
            .replace(/\}/g, '&#125;')
          return {
            code: `\n\n<div v-pre>\n\n${escaped}\n\n</div>\n`,
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
  // Remove manualChunks to fix "Circular chunk" warning/error
  build: {
    chunkSizeWarningLimit: 2000,
  },
  ssr: {
    // FIX: Add @unlazy/vue to noExternal to fix [ERR_UNKNOWN_FILE_EXTENSION]
    noExternal: [
      '@nolebase/integrations',
      '@nolebase/vitepress-plugin-enhanced-readabilities',
      '@nolebase/vitepress-plugin-highlight-targeted-heading',
      '@nolebase/vitepress-plugin-git-changelog',
      '@nolebase/vitepress-plugin-page-properties',
      '@unlazy/vue',
      'unlazy',
    ],
  },
})
