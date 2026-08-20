# no-mistakes gate: push through the AI verification pipeline

Murmur's local push gate. It sits between your branch and `origin` on GitHub: pushing through it runs the full AI-driven verification pipeline in a disposable worktree, and only a fully green run gets forwarded as a real push plus a clean PR.

## When to use it

- You want every check (review, tests, docs, lint) green **before** the branch reaches GitHub and burns CI minutes.
- An agent delivers work in firstmate's `no-mistakes` ship mode.
- You do not want to remember the full `pnpm ci:check` ritual by hand.

Plain `git push origin <branch>` still works and is unchanged - the gate is opt-in per push.

## How to push through the gate

```bash
git push no-mistakes <branch>
```

The gate remote points at a local bare repository (`~/.no-mistakes/repos/...`). On push it:

1. Creates a disposable worktree at the pushed commit.
2. Runs the pipeline: AI review, tests, docs check, lint.
3. Applies mechanical fixes automatically; **changes of intent require your approval** in the terminal.
4. Forwards to `origin` and opens a PR only when everything is green.

Any red step stops the push: the branch never reaches GitHub in a failing state.

## Agent usage

Agents can invoke the same gate via the `/no-mistakes` skill (installed at user level). Prefer pushing through the gate for any non-trivial delivery; see also the delivery gates in `CLAUDE.md`.

| Concern                        | Answer                                                            |
| ------------------------------ | ----------------------------------------------------------------- |
| Does it slow me down           | Pipeline runs in an isolated worktree; you can keep working       |
| Which agent does the AI review | Whichever `claude` resolves to at that moment (relay-transparent) |
| Where is gate state            | `~/.no-mistakes/` - nothing runs resident                         |
