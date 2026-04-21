import { join } from 'node:path'
import { presetVite } from '@nolebase/integrations/vitepress/vite'
import UnoCSS from 'unocss/vite'

import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'
import Inspect from 'vite-plugin-inspect'

import { creators, githubRepoLink } from './metadata'

export default defineConfig(async () => {
  const nolebase = presetVite({
    gitChangelog: {
      options: {
        gitChangelog: {
          repoURL: () => githubRepoLink,
          mapAuthors: creators,
        },
        markdownSection: {
          excludes: [
            join('repo', 'toc.md'),
            join('repo', 'index.md'),
          ],
        },
      },
    },
    pageProperties: {
      options: {
        markdownSection: {
          excludes: [
            join('repo', 'toc.md'),
            join('repo', 'index.md'),
          ],
        },
      },
    },
    thumbnailHash: false,
  })

  // Filter out thumbnail-hash plugins from nolebase.plugins() by name
  // to prevent OOM during Vercel builds
  const rawPlugins: any[] = nolebase.plugins()
  const filteredPlugins = rawPlugins.filter((p) => {
    const name: string = p?.name ?? ''
    return !name.includes('thumbnail-hash') && !name.includes('nolebase-thumbnail')
  })

  return {
    assetsInclude: [
      '**/*.mov',
    ],
    optimizeDeps: {
      exclude: [
        'vitepress',
      ],
    },
    plugins: [
      Inspect(),
      Components({
        include: [/\.vue$/],
        dirs: '.vitepress/theme/components',
        dts: '.vitepress/components.d.ts',
      }),
      UnoCSS(),
      nolebase,
      ...filteredPlugins,
    ],
    resolve: {
      alias: {
        '@nolebase/vitepress-plugin-thumbnail-hash': '/dev/null',
        '@nolebase/vitepress-plugin-thumbnail-hash/dist/chunkhash': '/dev/null',
      },
    },
  }
})
