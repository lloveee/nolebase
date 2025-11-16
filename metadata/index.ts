import type { Creator } from '../scripts/types/metadata'
import { getAvatarUrlByGithubName } from '../scripts/utils'

/** 文本 */
export const siteName = 'lloveee-blog'
export const siteShortName = 'lloveee-blog'
export const siteDescription = '手脑并用'

/** 文档所在目录 */
export const include = ['notes', '生活']

/** Repo */
export const githubRepoLink = 'https://github.com/lloveee/nolebase'
/** Discord */
export const discordLink = 'https://discord.gg/'

/** 无协议前缀域名 */
export const plainTargetDomain = 'lloveee.20250430.xyz'
/** 完整域名 */
export const targetDomain = `https://${plainTargetDomain}`

/** 创作者 */
export const creators: Creator[] = [
  {
    name: 'mimizh',
    avatar: '',
    username: 'lloveee',
    title: 'lloveee-blog creator',
    desc: 'exploring anything interesting',
    links: [
      { type: 'github', icon: 'github', link: 'https://github.com/lloveee' },
    ]
  },
].map<Creator>((c) => {
  c.avatar = c.avatar || getAvatarUrlByGithubName(c.username)
  return c as Creator
})

export const creatorNames = creators.map(c => c.name)
export const creatorUsernames = creators.map(c => c.username || '')
