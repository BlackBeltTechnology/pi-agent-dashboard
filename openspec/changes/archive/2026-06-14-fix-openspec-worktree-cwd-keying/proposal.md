# Fix OpenSpec card not reflecting manual task edits in worktree sessions

## Why

When the user checks an OpenSpec task done in a worktree session (edits the
worktree's `tasks.md`, or the change only exists on the worktree branch), the
folder-level OpenSpec card does not update.

Root cause is a cwd-keying mismatch with worktree grouping:

```
session.cwd = /repo/.worktrees/feat-x      (separate working copy of tasks.md)
      │ resolveSessionGroupPath: pin > jjState > gitWorktree.mainPath
      ▼
group.cwd   = /repo                         (main repo path)

SessionList.tsx (group render):
  FolderOpenSpecSection ← openspecMap.get(group.cwd)   = /repo  ◄ prominent card
  TasksPopover          ← cwd={group.cwd}              = /repo  ◄ reads/writes MAIN copy
  per-session card      ← openspecMap.get(session.cwd) = worktree (less prominent)
```

A git worktree has a **separate working tree**, so
`openspec/changes/<change>/tasks.md` is a distinct file from the main repo's.
The fs watcher polls the worktree cwd and broadcasts `openspec_update` keyed by
the worktree cwd — only the small per-session card reflects it. The prominent
folder card reads `openspecMap.get(/repo)`, which the user never touched, so it
shows nothing or a stale main-repo copy. Worse, ticking a box in the folder
card's `TasksPopover` writes to `/repo`'s `tasks.md`, not the worktree the user
is actually working in.

Plain (non-worktree) sessions are unaffected: `session.cwd === group.cwd`.

## What changes

### 1. Folder OpenSpec section aggregates member-cwd OpenSpec data

`SessionList.tsx` builds the data passed to `FolderOpenSpecSection` as a
**union** over `group.cwd` plus every member session's distinct cwd
(worktree cwds). Changes from worktree working copies appear in the same card
as the main repo's, de-duplicated by change name (main-repo entry wins on
collision; worktree-only changes are appended and tagged with their origin
cwd).

### 2. Task read/toggle target the change's actual cwd

Each change row carries the cwd it was discovered under. `TasksPopover` and the
toggle/read calls use that per-change cwd, so ticking a box edits the working
copy the change actually lives in — never the wrong tree.

### 3. Worktree-origin changes are visually marked

A change row sourced from a worktree cwd (not `group.cwd`) shows a small
worktree indicator so the user knows which working copy it edits.

## Impact

- Affected specs: `openspec-folder-section`
- Affected code: `packages/client/src/components/SessionList.tsx`,
  `FolderOpenSpecSection.tsx`, `TasksPopover.tsx` (per-change cwd threading)
- Server already broadcasts `openspec_update` per cwd including worktree cwds
  (they are session cwds → in `computeKnownDirectories`), so no server change
  is required for the data to exist; this is a client aggregation + cwd-routing
  fix.
- Out of scope: ended-worktree-session pruning (cwd leaves
  `computeKnownDirectories` → no watcher) — tracked separately.
