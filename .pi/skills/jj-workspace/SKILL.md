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

## Reattaching a detached git HEAD

In a colocated repo, jj routinely leaves `git HEAD` **detached** at the commit
hash of `@-` even when that commit is the tip of a bookmark. `git status` shows
`HEAD detached from <hash>`; IDEs and `git push` may complain. jj itself does
not care — `@` is still tracked correctly — but downstream git tooling does.

This is **not** a corruption. It happens whenever `@` is a working-copy commit
above a bookmark, which is the normal jj layout.

**Use the helper script** —
`.pi/skills/jj-workspace/scripts/reattach-head.mjs` — do NOT call
`git symbolic-ref` directly. The script enforces every precondition from
"Risks" (below) and serializes cooperating agents via an atomic O_CREAT|O_EXCL
advisory lock. Rolling your own is how `[fail]` modes happen.

**Cross-platform**: the canonical implementation is the `.mjs` file. It runs
under Node.js with built-ins only — macOS / Linux / Windows (PowerShell, cmd,
Git Bash, WSL) all work identically. A `.sh` shim is provided for callers
that prefer bash ergonomics; it simply `exec node`s the `.mjs`.

```bash
# 1. Find the bookmark name that points at @-'s commit:
jj log -r '@-' --no-graph -T 'bookmarks ++ "\n"'

# 2. Invoke the helper (replace <branch> verbatim). Pick whichever entry
#    point matches your environment:
node .pi/skills/jj-workspace/scripts/reattach-head.mjs <branch>   # any OS
.pi/skills/jj-workspace/scripts/reattach-head.sh <branch>         # bash / Git Bash

# 3. Verify (helper does this internally, but useful in tool output):
git status              # should now show "On branch <branch>"
jj status               # should be unchanged — @ still points at the same change
```

The helper exit codes are structured for LLM consumption:

| Exit | Meaning | LLM next step |
|------|---------|---------------|
| 0    | success, HEAD attached | continue |
| 1    | usage / not in colocated repo | fix the call |
| 2    | branch ref does not exist | check `jj log` for the real bookmark name |
| 3    | HEAD hash ≠ branch tip hash | use `jj new <branch>` or `jj edit <branch>` instead — do NOT force the ref |
| 4    | jj op in flight (multiple op heads) | inspect `jj op log`, resolve, retry |
| 5    | advisory lock held by another agent | wait + retry, or investigate stale lock |
| 6    | post-condition failed (HEAD didn't attach) | report to user, hand off |
| 7    | uncommitted changes + recent jj activity | escalate, do not reattach blindly |

Rules:

- ✅ `node reattach-head.mjs <branch>` — canonical, cross-platform, enforced
  pre-flight + atomic locked op.
- ✅ `reattach-head.sh <branch>` — bash shim around the `.mjs`; same contract.
- ✅ `git symbolic-ref HEAD refs/heads/<branch>` — raw op, allowed only when
  Node.js is unavailable (e.g. emergency recovery from an environment that
  cannot run the helper) AND you have manually verified every precondition.
- ❌ `git checkout <branch>` — touches tracked files, forbidden.
- ❌ `git switch <branch>` — same problem as checkout, forbidden.

If the bookmark tip is *not* at the same commit as HEAD, do not reattach with
`symbolic-ref`. Instead, move `@` with `jj edit <bookmark>` or `jj new
<bookmark>` and let jj re-emit HEAD itself.

### Risks of `git symbolic-ref` — verify before you call it

The op is safe **only when its preconditions hold**. Concrete failure modes:

1. **Wrong-commit reattach.** If the bookmark moved between inspection and
   reattach, HEAD now points at a commit that does not match the working copy.
   jj reconciles on the next command and may silently move `@` or mark files
   conflicted. **Mitigation**: immediately before the call, run
   `[ "$(git rev-parse HEAD)" = "$(git rev-parse refs/heads/<branch>)" ]` and
   abort if the hashes differ.

2. **Concurrent jj op.** jj takes a lockfile on `.jj/repo/op_heads/` for its
   own operations. `git symbolic-ref` bypasses that lock. If another jj
   command runs simultaneously (another agent, IDE auto-snapshot, background
   watcher), the HEAD update can be undone by jj's next export step.
   Last-writer-wins. **Mitigation**: run `jj status` first to confirm no
   pending op; never call `symbolic-ref` while a long-running jj op (rebase,
   absorb, import) is in flight.

3. **`HEAD@git` desync.** jj records its own `HEAD@git` marker in
   `.jj/repo/store/`. `git symbolic-ref` only touches `.git/HEAD`. Next
   `jj git import` (implicit in most jj commands) reconciles them — usually
   fine, occasionally surfaces "git refs diverged" warnings. **Recovery**:
   `jj op restore <op-id>` from `jj op log` rolls back.

4. **No ref validation.** `git symbolic-ref` does not verify that
   `refs/heads/<branch>` exists or that it points at the current commit. A
   typo points HEAD at a phantom ref — `git status` then shows nothing
   tracked. **Recovery**: re-run `symbolic-ref` with the correct name, or
   `git update-ref HEAD <hash>` to detach again.

5. **Multi-workspace bleed.** If `jj workspace add` has created sibling
   workspaces, the colocated repo's `.git/HEAD` is **per-workspace** (each
   workspace gets its own `.git/`), but the shared `.jj/repo/` is global.
   Reattaching HEAD in workspace A does not affect workspace B's HEAD, but
   it does affect what `jj git import` will see when run from A. Reason
   about per-workspace state, not global.

**Does not help parallel agents.** This op is a single-agent ergonomic fix.
Two agents in the **same** workspace will still race on `.git/index`,
working-copy snapshots, and the op log — unsafe regardless of HEAD attachment.
For true parallelism use `jj workspace add <path>` so each agent has its own
`@` and its own `.git/`; coordinate bookmark pushes via the
`jj-workspace-fold-back` skill.

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
