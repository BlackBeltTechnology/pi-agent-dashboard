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
  version: "1.0"
---

# Working in a Jujutsu Workspace

You are inside a jj workspace. The repository root has both `.jj/` and `.git/`
side by side — this is a **colocated** repo. jj is the source of truth; git
sees translated refs.

## 🚨 NEVER use mutating `git` commands in this repo

In a colocated repo, the following git commands silently corrupt jj history
and **cause irreversible file loss**. The jj data model is fundamentally
different — git has no concept of it, but jj writes the git index/refs
through a translator that breaks when git mutates state behind its back.

❌ **Forbidden:**

- `git commit`
- `git rebase`
- `git cherry-pick`
- `git merge`
- `git reset --hard`
- `git checkout` on tracked files
- `git stash` (including `git stash pop`)

✅ **Allowed (read-only):**

- `git log`, `git diff`, `git show`, `git blame`, `git grep`
- `git remote -v`, `git config --get …` (read)

✅ **Safe git mutations** (touch only git-private state, jj doesn't read):

- `git reset` (no flags) — clears the index, leaves working tree alone
- `git config <key> <value>` — git config doesn't intersect with jj

If you need to "set work aside", **never use `git stash`**. Use:

```bash
jj describe -m "WIP: experimenting with X"
jj new
# now `@` is empty, your work is in `@-`. Come back via `jj edit <change-id>`.
```

## Quick reference: jj is not git

| Concept                | git                       | jj                                     |
|------------------------|---------------------------|----------------------------------------|
| current commit         | `HEAD`                    | `@` (working copy is itself a commit)  |
| parent                 | `HEAD^` / `HEAD~1`        | `@-`                                   |
| grandparent            | `HEAD~2`                  | `@--`                                  |
| stage area             | the index                 | (none — every edit is in `@`)          |
| branch                 | branch                    | bookmark                               |
| commit message         | edited at commit time     | `jj describe -m "msg"`                 |
| set work aside         | `git stash`               | `jj new` (then `jj edit @-` to return) |
| amend last commit      | `git commit --amend`      | edit files; jj auto-snapshots into `@` |
| rebase                 | `git rebase`              | `jj rebase -d <dest> -s <src>`         |

## Working in this workspace

```bash
jj st               # show working copy status
jj log              # show change graph
jj diff             # show working copy changes
jj diff --from develop --to @   # show all changes since trunk
jj describe -m "feat: ..."     # set commit description
jj new              # create a fresh empty change on top of @
```

## Conflicts

If you see conflict markers in files (`<<<<<<<` / `=======` / `>>>>>>>`):

```bash
jj resolve --list                # list files with conflicts
# edit files to resolve, then:
jj resolve <file>                # mark resolved (or just edit and save)
```

**Do not** run `git add` / `git commit` to resolve. jj tracks the conflict
state through its own mechanism.

## Shipping work back to trunk

When you're done in this workspace, invoke the `jj-workspace-fold-back`
skill. It handles bookmarking the workspace tip, rebasing onto trunk, and
pushing via `jj git push --bookmark` — the only git-touching operation
allowed in a colocated repo.

**Never** try to "merge the workspace" by running `git merge` or
`git commit`. Those produce immediate history corruption.

## When in doubt

- `jj op log` — see every operation jj has performed (recoverable via `jj op restore`)
- `jj undo` — undo the last operation
- `jj help <command>` — built-in help

If you need to do something that seems to require a forbidden git command,
stop and ask the user. jj almost certainly has a native equivalent
(`jj split`, `jj absorb`, `jj squash`, `jj abandon`, `jj op restore`).
