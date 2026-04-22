import { presetMarkdownIt } from '@nolebase/integrations/vitepress/markdown-it'
import { transformHeadMeta } from '@nolebase/vitepress-plugin-meta'
import { calculateSidebar } from '@nolebase/vitepress-plugin-sidebar'
import MarkdownItFootnote from 'markdown-it-footnote'
import { defineConfig } from 'vitepress'

import { discordLink, githubRepoLink, siteDescription, siteName } from '../metadata'
import head from './head'

const nolebaseMd = presetMarkdownIt({ unlazyImages: false })

export default defineConfig({
  vue: {
    template: {
      compilerOptions: {
        // Safe elements for LaTeX and other custom syntaxes
        isCustomElement: (tag) => tag.includes('-') || tag.includes(':') || tag.includes('$'),
      },
    },
  },
  title: siteName,
  description: siteDescription,
  ignoreDeadLinks: true,
  head,
  themeConfig: {
    search: {
      provider: 'local',
    },
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Notes', link: '/repo/notes/' },
      { text: 'Refer', link: '/repo/refer/' },
    ],
    socialLinks: [
      { icon: 'github', link: githubRepoLink },
    ],
    sidebar: calculateSidebar([
      { folderName: 'repo/notes', separate: true },
      { folderName: 'repo/refer', separate: true },
    ], 'repo'),
    footer: {
      message: '用 <span style="color: #e25555;">&#9829;</span> 撰写',
      copyright: '© 2025 lloveee-blog',
    },
  },
  markdown: {
    theme: {
      light: 'github-light',
      dark: 'one-dark-pro',
    },
    config: (md) => {
      md.use(MarkdownItFootnote)
      nolebaseMd.install(md)
    },
  },
  async transformHead(context) {
    let head = [...context.head]
    const returnedHead = await transformHeadMeta()(head, context)
    if (typeof returnedHead !== 'undefined')
      head = returnedHead
    return head
  },
})
