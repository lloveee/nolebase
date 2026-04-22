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
        // Target specifically the 'refer' directory which contains messy PDF artifacts
        if (id.endsWith('.md') && id.replace(/\\/g, '/').includes('repo/refer')) {
          // 1. Extreme escaping: convert all sensitive chars to entities to shield from Vue compiler
          // This preserves the exact look for readers but makes it "invisible" to Vue's parser.
          const escaped = code
            .replace(/\\/g, '&#92;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\$/g, '&#36;')
            .replace(/\{/g, '&#123;')
            .replace(/\}/g, '&#125;')
          
          // 2. Wrap in v-pre for good measure
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
