export type Comment = { author: string; body: string; url: string }
export type Thread = {
  id: string
  path: string
  // Where the comment points: `line` on `side` (RIGHT is the PR head, LEFT the
  // old file), `startLine` for a multi-line comment. `isHistorical` when the
  // thread is outdated and only its original line is known.
  line: number | null
  startLine: number | null
  side: 'LEFT' | 'RIGHT' | null
  startSide: 'LEFT' | 'RIGHT' | null
  isHistorical: boolean
  isOutdated: boolean
  // The last lines of the diff the opening comment was made on.
  hunk: string
  // All comments on GitHub; `comments` holds the opening one plus the latest.
  total: number
  comments: Comment[]
}
// One repo + branch: its open PR and that PR's unresolved threads, or none.
// `failed` marks a fetch that did not get a definite answer; `threads` then
// holds whatever was last known. `stamp` orders fetches: an older one never
// overwrites a newer answer.
export type PrCache = {
  fetchedAt: number
  stamp: number
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
