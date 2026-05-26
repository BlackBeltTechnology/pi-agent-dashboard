---
name: jj-workspace
description: >
  Operating manual for agents working inside a Jujutsu (jj) workspace.
  Read this when your cwd is under a `.shadow/<name>/` directory or any other
  `jj workspace add` target. Lists safe vs. forbidden commands in colocated
  jj+git repos, the basic working-copy mental model, and how to describe and
  ship work back to trunk via the `jj-workspace-fold-back` skill.
  Use when: working in any jj workspace, before running `git` commands in a
  jj-managed cwd, when reviewing or describing changes, when conflicts appear,
  when asked to commit/push/merge in a jj repo.
license: MIT
metadata:
  source: pi-agent-dashboard / add-jj-workspace-plugin
  version: "2.0"
---

# Working in a Jujutsu Workspace

You are inside a jj workspace. The repo root has both `.jj/` and `.git/` —
this is a **colocated** repo. jj is the source of truth; git sees translated
refs.

**Related skills** (don't reach for git equivalents — use these):

- Push work to the git remote → **`jj-workspace-fold-back`**
- Undo a jj commit, keep the diff as working-copy changes → **`jj-uncommit-to-working-copy`**

## The one thing you have to internalise

**jj's working copy `@` is a real commit.** Every keystroke auto-snapshots
into it. Git cannot represent a still-snapshotting commit, so its `HEAD`
points at `@-` (the parent) and reads as **detached**.

```
   bookmark main ──▶ ┌──────────┐ ◀── git HEAD (detached, by design)
                     │   @-     │
                     └────▲─────┘
                          │ parent
                     ┌────┴─────┐
                     │    @     │ ◀── jj working copy
                     │ (snapshot)│
                     └──────────┘
```

Consequences — these are not bugs:

- `git status` says **"HEAD detached from <hash>"**. Normal. Ignore it.
- `git log --oneline` shows the bookmark tip, not your working copy. Normal.
- jj never "reattaches" HEAD on its own. There is nothing to reattach to,
  because no bookmark points at `@` (working-copy commits are not bookmarked).

**Rule: read `jj st`, not `git status`.** Almost every "mixed signal" between
the two tools dissolves when you stop asking git questions it can't answer.

## 🚨 Never run mutating `git` commands here

In a colocated repo these silently corrupt jj history and can cause
**irreversible file loss**. jj exports state through a translator that
breaks when git mutates refs/index behind its back.

❌ **Forbidden:** `git commit`, `git rebase`, `git cherry-pick`, `git merge`,
`git reset --hard`, `git checkout` on tracked files, `git switch`,
`git stash` (including pop).

✅ **Read-only is fine:** `git log`, `git diff`, `git show`, `git blame`,
`git grep`, `git remote -v`, `git config --get …`.

✅ **Safe writes** (git-private state jj doesn't read): `git reset` (no
flags — clears index only), `git config <key> <value>`.

If you'd reach for `git stash`, use jj instead:

```bash
jj describe -m "WIP: experimenting"
jj new                    # @ is now empty; old work lives in @-
# return later via:
jj edit <change-id>
```

## jj quick reference

| Concept            | git                  | jj                                |
|--------------------|----------------------|-----------------------------------|
| current commit     | `HEAD`               | `@`                               |
| parent             | `HEAD^`              | `@-`                              |
| stage area         | the index            | (none — edits snapshot into `@`)  |
| branch             | branch               | bookmark                          |
| set message        | edit at commit time  | `jj describe -m "…"`              |
| set work aside     | `git stash`          | `jj new` (return via `jj edit @-`)|
| amend last commit  | `git commit --amend` | just edit; jj auto-snapshots      |
| rebase             | `git rebase`         | `jj rebase -d <dest> -s <src>`    |
| uncommit (re-stage)| `git reset HEAD~1`   | see `jj-uncommit-to-working-copy` |
| push to remote     | `git push`           | see `jj-workspace-fold-back`      |

Daily commands:

```bash
jj st                            # working-copy status
jj log                           # change graph
jj diff                          # working-copy changes
jj diff --from <trunk> --to @    # everything since trunk
jj describe -m "feat: ..."       # set @'s description
jj new                           # fresh empty change on top of @
```

## Conflicts

Conflict markers (`<<<<<<<` / `=======` / `>>>>>>>`) in files:

```bash
jj resolve --list      # list conflicted files
# edit files to resolve, save — jj re-snapshots automatically
```

**Never** `git add` / `git commit` to mark resolution. jj tracks conflict
state through its own mechanism.

## Shipping work back to trunk

Use the `jj-workspace-fold-back` skill. It bookmarks the tip, rebases onto
trunk, and pushes via `jj git push --bookmark` — the only git-touching write
allowed in a colocated repo. **Never** `git merge` or `git commit` to land
work; both corrupt history immediately.

## Recovery

- `jj op log` — every jj op is recorded with an id.
- `jj op restore <id>` — undo to that op. The universal escape hatch.
- `jj undo` — undo the last op.
- `jj help <command>` — built-in help.

If you think you need a forbidden git command, stop and ask. jj has a native
equivalent (`jj split`, `jj absorb`, `jj squash`, `jj abandon`,
`jj op restore`).

---

## Footnote: reattaching git HEAD

You almost never need this. Reattachment exists for **handing off the repo
to non-jj-aware tooling** — an IDE that refuses to operate on detached HEAD,
a CI runner that checks the branch name, a `git push` you can't replace with
`jj git push`. **Do not reattach as routine hygiene.** Detached HEAD is the
correct steady state; reattaching and going back to work just detaches it
again on the next jj op.

When you do need it:

```bash
# 1. Find the bookmark at @-:
jj log -r '@-' --no-graph -T 'bookmarks ++ "\n"'

# 2. Call the helper. Never roll your own — it enforces every precondition
#    below and serialises cooperating agents via an atomic advisory lock.
node .pi/skills/jj-workspace/scripts/reattach-head.mjs <branch>
.pi/skills/jj-workspace/scripts/reattach-head.sh <branch>     # bash shim
```

Cross-platform: the `.mjs` runs anywhere Node does (macOS / Linux /
Windows PowerShell / cmd / Git Bash / WSL). The `.sh` just `exec node`s it.

Exit codes:

| Exit | Meaning                          | Next step                                        |
|------|----------------------------------|--------------------------------------------------|
| 0    | success                          | continue                                         |
| 1    | usage / not in colocated repo    | fix the call                                     |
| 2    | branch ref does not exist        | re-check `jj log` for the real bookmark name     |
| 3    | HEAD hash ≠ branch tip hash      | use `jj new <branch>` or `jj edit <branch>`      |
| 4    | jj op in flight                  | inspect `jj op log`, resolve, retry              |
| 5    | advisory lock held               | wait + retry, or investigate stale lock          |
| 6    | post-condition failed            | report to user                                   |
| 7    | uncommitted changes + jj activity| escalate; do not blindly reattach                |

Forbidden alternatives (each one corrupts in a different way):

- ❌ `git checkout <branch>` / `git switch <branch>` — touches tracked files.
- ❌ Raw `git symbolic-ref HEAD refs/heads/<branch>` — bypasses every
  precondition the helper checks. Allowed only as last-resort recovery when
  Node is unavailable AND you have manually verified hashes match, no jj op
  is in flight, and no sibling workspace is racing.

If the bookmark tip is *not* at the same commit as HEAD, do not reattach.
Move `@` instead: `jj edit <bookmark>` or `jj new <bookmark>`. jj will
re-export HEAD itself.

### Why the helper is strict (the failure modes it prevents)

1. **Wrong-commit reattach.** Bookmark moves between inspection and call →
   HEAD points at a commit that doesn't match the working copy → jj
   reconciles on next op, may move `@` or mark files conflicted.
2. **Concurrent jj op.** jj locks `.jj/repo/op_heads/` for its own ops;
   `git symbolic-ref` bypasses that lock. Last-writer-wins.
3. **`HEAD@git` desync.** jj's `HEAD@git` marker lives in `.jj/repo/store/`
   and reconciles on next implicit `jj git import` — usually silent,
   occasionally surfaces "git refs diverged".
4. **Typo'd ref.** `symbolic-ref` doesn't validate. HEAD then points at a
   phantom ref and `git status` shows nothing tracked.
5. **Multi-workspace bleed.** Each `jj workspace add` has its own
   per-workspace `.git/HEAD`; the shared `.jj/repo/` is global. Reason
   per-workspace, not global.

**Reattachment does not enable parallel agents.** Two agents in the *same*
workspace still race on `.git/index`, snapshots, and the op log — unsafe
regardless of HEAD state. For real parallelism use `jj workspace add` so
each agent gets its own `@` and its own `.git/`; coordinate via
`jj-workspace-fold-back`.
