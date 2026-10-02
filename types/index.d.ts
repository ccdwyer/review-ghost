export type Comment = { author: string; body: string; url: string }
export type Thread = {
  id: string
  path: string
  line: number | null
  isOutdated: boolean
  // All replies on GitHub, though only the latest are kept in `comments`.
  total: number
  comments: Comment[]
}
// One repo + branch: its open PR and that PR's unresolved threads, or none.
// `failed` marks a fetch that did not get a definite answer; `threads` then
// holds whatever was last known.
export type PrCache = {
  fetchedAt: number
  number: number | null
  url: string
  threads: Thread[]
  failed: boolean
  isPartial: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'review-ghost': {
      prs: Record<string, PrCache>
      // Per agent ('' is the main loop): `${thread id}:${reply count}` already shown this turn.
      shown: Record<string, string[]>
    }
  }
}
