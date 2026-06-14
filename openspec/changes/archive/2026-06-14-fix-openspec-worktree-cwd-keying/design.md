# Design — OpenSpec worktree cwd keying

## Context

- Sessions group via `resolveSessionGroupPath` (pin > jjState.workspaceRoot >
  gitWorktree.mainPath). Worktree sessions group under the **main repo** cwd.
- `SessionList.tsx:675-693` renders `FolderOpenSpecSection` with
  `data={openspecMap.get(group.cwd)}` and `cwd={group.cwd}`.
- `openspecMap` is keyed by cwd; the server already populates entries for
  worktree cwds (they are session cwds → in `computeKnownDirectories`).
- `TasksPopover` reads/toggles via `/api/openspec/tasks*` with the `cwd` prop —
  currently `group.cwd`.

## Decision

Keep server keying by cwd (correct — each working tree is a distinct file
set). Fix the **client** so the folder card presents the union of the group's
working copies and routes per-change reads/writes to the right cwd.

### Aggregation rule (client, in `SessionList`)

```
memberCwds = distinct( [group.cwd, ...group.sessions.map(s => s.cwd)] )
entries    = memberCwds.flatMap(cwd =>
               (openspecMap.get(cwd)?.changes ?? []).map(c => ({ ...c, sourceCwd: cwd }))
             )
// de-dupe by change name; group.cwd wins on collision
```

`initialized` / `pending` / `hasOpenspecDir` for the card = OR-fold across
member cwds (card shows if any member has openspec).

### Per-change cwd threading

`FolderOpenSpecSection` change rows already map 1:1 to changes; attach
`sourceCwd` to each row. `TasksPopover` receives `cwd={row.sourceCwd}` instead
of the section-level `group.cwd`. Refresh / read-artifact / spawn-attach
actions likewise use `row.sourceCwd`.

## Why client-side aggregation (not server-side group data)

Server keying-by-cwd is the correct invariant — collapsing it server-side
would lose the per-working-copy distinction the toggle needs. The grouping is
a **client presentation** concept (`resolveSessionGroupPath` lives client-side),
so the union belongs there too. No protocol change.

## Collision semantics

Same change name can exist in both main and a worktree (worktree branched from
main). Main-repo entry wins for display so the "canonical" copy is shown;
worktree-only changes (not yet in main) are appended and marked. This avoids
double-listing while still surfacing worktree-only work.

## Out of scope

- Ended worktree session pruning removing the cwd from
  `computeKnownDirectories` (no watcher → no live updates). Separate change.
- Merging task **state** across copies (we display per-copy, we do not
  reconcile divergent checkboxes).
