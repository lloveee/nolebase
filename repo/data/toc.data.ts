import { createRecentUpdatesLoader } from '@nolebase/vitepress-plugin-index/vitepress'

export default createRecentUpdatesLoader({
  dir: 'repo/notes',
  rewrites: [
    // wired, it wasn't designed to work like this.
    {
      from: /^repo\/notes/,
      to: 'repo/notes',
    },
  ],
})
