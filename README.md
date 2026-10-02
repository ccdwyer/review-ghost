# Review Ghost 👻

![Review Ghost demo](media/demo.gif)


A Claude Code mod that brings your PR's unresolved review comments to the file Claude is already working in.

When Claude **Reads** or **Edits** a file in a git repo whose current branch has an open GitHub PR, it receives that file's unresolved review threads along with the tool result: path, line, author, comment text and a link. Each thread is shown once per turn, and again if a new reply arrives. Comments are quoted as data, so a reviewer's text can't steer the model.

- **`/ghost`** lists every unresolved thread on the PR and forces a refresh. It runs immediately, even mid-turn.
- **Status line:** `👻 3 unresolved on PR #42`.
- Uses your existing `gh` login. The PR and its threads are cached per repo and branch for 2 minutes.
- Fails silently and fast when you're not in a repo, `gh` is missing, there's no PR, or you're offline.

Requires the [GitHub CLI](https://cli.github.com/) (`gh auth login`).

## Install

```
/plugin marketplace add ccdwyer/claude-mods
/plugin install review-ghost@ccdwyer-mods
/reload-plugins
```

## Develop

```
claude plugin validate .
claude plugin test .
```

## What it hooks

Events this mod hooks, as `claude plugin validate` reads the module:

- `session.start`
- `turn.start`
- `command.run{command=ghost}`
- `tool.call{tool=Read|Edit|Write}`

Engine calls it makes: `$.clock.now (via prFor)`, `$.command.register`, `$.process.run`, `$.state.get`, `$.state.set`, `$.ui.status`.

A `tool.call` hook sits in the middle of every tool call: it can see the call, refuse it, or add context to its result. This mod uses that only for the behaviour described above.

## License

MIT
