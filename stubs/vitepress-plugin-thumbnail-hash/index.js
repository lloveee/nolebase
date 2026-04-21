// Stub: returns a noop Vite plugin to prevent thumbnail hash generation (OOM fix)
export default function thumbnailHashStub() {
  return {
    name: '@nolebase/vitepress-plugin-thumbnail-hash-stub',
    enforce: 'pre',
  }
}
