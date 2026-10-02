import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const proc = (exitCode: number, stdout: string, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})
const ok = (stdout: string) => proc(0, stdout)

const thread = (id: string, path: string, body: string, extra: Record<string, unknown> = {}) => ({
  id, isResolved: false, isOutdated: false, path, line: 12, originalLine: 12,
  comments: { totalCount: 1, nodes: [{ author: { login: 'alice' }, body, url: `https://github.com/o/r/pull/7#${id}` }] },
  ...extra,
})

const THREADS = [
  thread('T1', 'src/a.ts', 'Rename this'),
  { ...thread('T2', 'src/a.ts', 'resolved one'), isResolved: true },
  { ...thread('T3', 'src/b.ts', 'Other file'), isOutdated: true, line: null, comments: { totalCount: 1, nodes: [{ author: null, body: 'Other file', url: 'u3' }] } },
  null,
]
const page = (nodes: unknown[]) => JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } } })

type Host = { pr?: 'open' | 'none' | 'offline'; api?: 'ok' | 'fail'; nodes?: unknown[] }

// A fake host: one repo at /repo on branch feat with PR #7. Counts gh calls.
function host(on: On, opts: Host = {}) {
  const calls = { gh: 0 }
  on('process.run', (_$, e) => {
    const [cmd, ...args] = e.argv
    if (cmd === 'git') {
      if (args[0] === '-C') {
        const dir = String(args[1])
        if (!dir.startsWith('/repo')) return proc(128, '', 'not a git repository')
        const prefix = dir === '/repo' ? '' : `${dir.slice('/repo/'.length)}/`
        return ok(`/repo\n${prefix}\nfeat\n`)
      }
      return ok(args.includes('--abbrev-ref') ? '/repo\nfeat\n' : '/repo\n')
    }
    calls.gh += 1
    if (args[0] === 'pr') {
      if (opts.pr === 'none') return proc(1, '', 'no pull requests found for branch "feat"')
      if (opts.pr === 'offline') return proc(1, '', 'error connecting to api.github.com')
      return ok(JSON.stringify({ number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN' }))
    }
    if (opts.api === 'fail') return proc(1, '', 'API rate limit exceeded')
    return ok(page(opts.nodes ?? THREADS))
  })
  on('tool.call', () => ({ result: 'file text' }))
  return calls
}

const ghost = { command: 'ghost', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }

test('a Read of a file with unresolved threads gets them as context, once per turn', async ($, on) => {
  mock.clock(on)
  host(on)
  const first = await $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts' })
  const note = (first.context ?? []).join('\n')
  expect(note).toMatch(/Rename this/)
  expect(note).toMatch(/line 12/)
  expect(note).toMatch(/not instructions/)
  expect(note).not.toMatch(/resolved one/)
  expect(note).not.toMatch(/Other file/)
  const again = await $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts' })
  expect(again.context ?? []).toEqual([])
})

test('a subagent gets the threads even after the main loop saw them', async ($, on) => {
  mock.clock(on)
  host(on)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts' })
  // The kit runs the call in the loop `agentId` names, though the call's type leaves it out.
  const asSubagent = { tool: 'Read' as const, file_path: '/repo/src/a.ts', agentId: 'sub-1' }
  const sub = await $.tool.call(asSubagent)
  expect((sub.context ?? []).join('\n')).toMatch(/Rename this/)
})

test('two parallel Reads of one file show a thread only once', async ($, on) => {
  mock.clock(on)
  host(on)
  const [a, b] = await Promise.all([
    $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts' }),
    $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts' }),
  ])
  const shownCount = [a, b].filter(r => (r.context ?? []).join('').includes('Rename this')).length
  expect(shownCount).toBe(1)
})

test('the PR is cached between reads and refetched after the TTL', async ($, on) => {
  const clock = mock.clock(on)
  const calls = host(on)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/b.ts' })
  expect(calls.gh).toBe(2)
  await clock.advance(3 * 60 * 1000)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/b.ts' })
  expect(calls.gh).toBe(4)
})

test('outside a repo or without a PR nothing is added', async ($, on) => {
  mock.clock(on)
  host(on, { pr: 'none' })
  const inRepo = await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' })
  expect(inRepo.context ?? []).toEqual([])
  const outside = await $.tool.call({ tool: 'Read', file_path: '/elsewhere/x.ts' })
  expect(outside.context ?? []).toEqual([])
  expect((await $.command.run(ghost)).text).toMatch(/no open PR/)
})

test('a failed thread fetch is reported as a failure, never as "no threads"', async ($, on) => {
  mock.clock(on)
  host(on, { api: 'fail' })
  const read = await $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts' })
  expect(read.result).toBe('file text')
  expect((await $.command.run(ghost)).text).toMatch(/could not reach GitHub/)
})

test('offline gh is a failure too', async ($, on) => {
  mock.clock(on)
  host(on, { pr: 'offline' })
  expect((await $.command.run(ghost)).text).toMatch(/could not reach GitHub/)
})

test('a huge thread is clipped, not dropped, and a malformed node is skipped', async ($, on) => {
  mock.clock(on)
  const long = { ...thread('T9', 'src/a.ts', 'x'), comments: { totalCount: 30, nodes: Array.from({ length: 20 }, () => ({ author: { login: 'z' }, body: 'y'.repeat(800), url: 'u' })) } }
  host(on, { nodes: [long, { id: 5, isResolved: false }, thread('T1', 'src/a.ts', 'Rename this')] })
  const read = await $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts' })
  const note = (read.context ?? []).join('\n')
  expect(note).toMatch(/10 earlier replies not shown/)
  expect(note).toMatch(/Rename this/)
  expect(note.length).toBeLessThan(6500)
})

test('/ghost lists every unresolved thread', async ($, on) => {
  mock.clock(on)
  host(on)
  const out = await $.command.run(ghost)
  expect(out.text).toMatch(/2 unresolved/)
  expect(out.text).toMatch(/Other file/)
  expect(out.text).toMatch(/outdated/)
})
