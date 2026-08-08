# Design — Drag folders into, out of, and between workspaces

## Context

`sidebar-drag-reorder` ships three drag gestures, all *ordering* only: workspace
reorder, intra-workspace folder reorder, pinned-group reorder. Three walls keep
membership changes out:

- `sameTypeClosestCenter` (`packages/client/src/lib/layout/sidebar-dnd.ts`)
  filters candidate droppables to those whose `data.type` equals the active
  draggable's type, *before* measuring distance.
- `handleDragEnd` (`SessionList.tsx:508-509`) early-returns on
  `activeType !== overType` — the first gate, before any branch.
- `resolveWorkspaceFolderReorder` returns `null` when `activeWsId !== overWsId`.

All three must come down together; removing only the first leaves the feature
inert.

The server is partly capable: `preferences-store.addFolderToWorkspace` enforces
single-membership by detaching from every other workspace before appending.
Missing: positional insert, and an eject that preserves pin side-effects.

## Goals / Non-Goals

**Goals**
- Drag a **pinned** directory or a **workspace folder** into a workspace
  (header = append, inner slot = positional).
- Drag a workspace folder out to the pinned tier, fully pinned.
- Drag a workspace folder between two workspaces.
- One server round-trip per gesture; no client-side optimistic state.

**Non-Goals**
- **Dragging an *unpinned* directory row.** Unpinned groups render outside any
  `SortableContext` with no drag handle and no `data.type`
  (`SessionList.tsx:1634`); making them draggable is a separate change. Users
  pin first, then drag.
- Session cards crossing folders; workspace reordering (shipped).
- Positional control over where an ejected folder lands in the pinned tier.
- A `DragOverlay` ghost — the sidebar has none today.

## Decisions

### D1 — One nullable-target message; validate before mutating

```ts
export interface MoveFolderToWorkspaceMessage {
  type: "move_folder_to_workspace";
  path: string;
  /** `null` ejects the folder from all workspaces and pins it. */
  toWorkspaceId: string | null;
  /** Insert position in the target. Omitted = append. Ignored when target is null. */
  index?: number;
}
```

**Ordering is load-bearing.** The store method resolves the target *first* and
returns `false` without touching state when it is unknown — mirroring
`addFolderToWorkspace`, which only detaches after `findWs(id)` succeeds. The
naive "detach from all, then insert" would leave the folder in **zero**
workspaces on a stale id.

```
  moveFolderToWorkspace(path, toWorkspaceId, index?)
    canon = canonicalize(path)                    ← store canonicalizes, always
    if (toWorkspaceId !== null):
        ws = findWs(toWorkspaceId)
        if (!ws) return false                     ← no mutation, no broadcast
        if (ws.folders.includes(canon)) return false   ← same-ws move rejected
        detach canon from every workspace
        ws.folders.splice(clamp(index ?? len, 0, len), 0, canon)
    else:
        if (canon in no workspace) return false
        detach canon from every workspace
    return true
```

`index` is **clamped** to `[0, folders.length]`. A negative index would make
`splice` count from the end, silently inserting before the last element.

**Same-workspace moves are rejected outright**, matching
`addFolderToWorkspace`'s `if (ws.folders.includes(canon)) return false`. A
weaker "only reject when it is the sole member" guard would let a stale client
(second browser, mid-broadcast) detach-and-reinsert: because the splice runs
*after* the detach, the array has shrunk by one, so a downward reposition lands
one slot too late and an omitted `index` silently jumps the folder to the end.
Same-workspace repositioning has its own message (`reorder_workspace_folders`,
which validates set-equality); this path never needs to serve it.

**Canonicalization**: the store method canonicalizes internally (like
`addFolderToWorkspace`), *not* the handler. `pinDirectory` is the opposite
convention — it expects a caller-canonical path — so the handler must
canonicalize once for the pin side and pass the raw path to the store, or pass
the canonical form to both. The handler passes the **canonical** form to both;
the store's internal canonicalize is idempotent.

### D2 — Eject reuses the *handler-level* pin path, not `pinDirectory`

`preferencesStore.pinDirectory` is a bare array push
(`preferences-store.ts:348-351`). The behavior users expect from pinning lives
in `handlePinDirectory` (`directory-handler.ts:21-45`): `onDirectoryAdded` →
historical on-disk session discovery → `sessionManager.register/unregister` →
`openspec_update` broadcast.

An ejected folder that skipped this would appear pinned but show none of its
on-disk history. So:

- Extract the body of `handlePinDirectory` after the store call into
  `pinDirectorySideEffects(resolved, ctx)`.
- `handlePinDirectory` and the eject branch of `handleMoveFolderToWorkspace`
  both call it.

**Helper boundary**: `pinDirectorySideEffects(resolved, ctx)` is everything in
`handlePinDirectory` *after* `preferencesStore.pinDirectory` — including the
`pinned_dirs_updated` broadcast, and preserving the existing
`if (!preferencesStore) return` / `if (directoryService)` guards. Callers must
not broadcast `pinned_dirs_updated` themselves.

**Every branch gates on the store's return**, matching the shipped handlers
(`if (store.addFolderToWorkspace(...)) broadcastWorkspaces(ctx)`,
`directory-handler.ts:137-155`):

```
  handleMoveFolderToWorkspace(msg, ctx):
    if (!ctx.preferencesStore) return             ← store is optional on ctx
    if (msg.index !== undefined && !Number.isInteger(msg.index)) return
    canon = canonicalizePath(msg.path)
    if (!store.moveFolderToWorkspace(canon, msg.toWorkspaceId, msg.index))
        return                                    ← no broadcast, no side effects
    if (msg.toWorkspaceId === null):
        store.pinDirectory(canon)
        pinDirectorySideEffects(canon, ctx)       ← pinned_dirs_updated FIRST
    broadcast workspaces_updated                  ← always LAST
```

Without the gate, a stale or repeated eject (the folder was already ejected by
another browser) would **pin a directory the user never pinned**, run directory
discovery, and broadcast — a mutation from a rejected request.

`preferencesStore` is optional on the handler context and every shipped handler
guards it; so does this one.

**`index` must be a finite integer.** `clamp` via `Math.min`/`Math.max`
propagates `NaN`, and `splice(NaN, 0, x)` coerces to `0` — a front insert where
the contract promises an append. The type annotation is not a runtime guard.

**Broadcast order on eject is load-bearing.** `pinned_dirs_updated` goes out
*before* `workspaces_updated`. The two arrive as separate WebSocket frames in
separate macrotasks, so React cannot batch them, and the intermediate render is
observable:

```
  workspaces_updated first  →  folder is in NEITHER list for one frame
                               → vanishes, or flashes through the unpinned tier
                                 (visibleTopUnpinned keeps it only if it still
                                  has a live session, SessionList.tsx:1630-1634)

  pinned_dirs_updated first →  folder is pinned but still `claimed` by the
                               stale workspace list, so visibleTopPinned
                               suppresses it (SessionList.tsx:428-434)
                               → it stays rendered in place, then transitions
                                 cleanly when workspaces_updated lands
```

### D3 — Collision detection becomes a compatibility matrix

`sameTypeClosestCenter` → `compatibleClosestCenter` in `sidebar-dnd.ts`, driven
by an exported matrix. The fallback distinguishes two cases the old function
conflated:

- **typeless active** (`type == null`) → `closestCenter` over all droppables,
  exactly as today.
- **typed active with no matrix row** (any future sidebar draggable) →
  same-type filtering, i.e. today's wall. Falling back to closestCenter-over-all
  here would be *weaker* than the current behavior and would silently let a new
  draggable resolve onto unrelated targets.

```
  session          → { session }                                    (unchanged wall)
  workspace        → { workspace }                                  (unchanged wall)
  workspace-folder → { workspace-folder, workspace-header, pinned-group, pinned-tier }
  pinned-group     → { workspace-folder, workspace-header, pinned-group }
```

`pinned-group` deliberately **excludes** `pinned-tier`: a pinned group is
already ejected, so the eject zone is meaningless for it and would produce a
dead target.

### D4 — A dedicated header droppable, because closestCenter defeats the node

Reusing the `SortableWorkspace` node (`type: "workspace"`, id = `ws.id`) as the
append target does not work: its rect spans header **plus** folder body, so its
center sits mid-body. Hovering the header strip of an *expanded* workspace
resolves to the nearest **folder** instead, and the append indicator never
shows. The node only wins when the workspace is empty or collapsed.

So `WorkspaceHeader` gets its own header-sized droppable,
`data: { type: "workspace-header", wsId: ws.id }`, id `wsh:<ws.id>`. The `wsId`
payload is mandatory — `resolveFolderMove` needs the target workspace and must
not string-parse the `wsh:` prefix. This mirrors `SortableWorkspaceFolder`,
which already carries `{ type, wsId }`. The droppable renders the standard
`dropIndicatorProps` treatment on `isOver`, so the append gesture gets the same
visual feedback as every other target. `SortableWorkspace` keeps
`type: "workspace"` for workspace reordering only — untouched.

| Gesture | Over droppable | New? |
|---|---|---|
| append into workspace | `workspace-header`, id `wsh:<id>` | **yes** |
| positional into workspace | `SortableWorkspaceFolder`, carries `wsId` | no |
| eject to pinned tier | `SortablePinnedGroup` | no |
| eject when pinned tier is empty | `PinnedTierDropZone`, id `__pinned_tier__` | **yes** |

`PinnedTierDropZone` mounts **outside** the `visibleTopPinned.length > 0` gate
(`SessionList.tsx:1607`) — that gate renders nothing when the tier is empty,
which is exactly when the zone is needed. Its sentinel id is namespaced so it
cannot collide with a folder cwd or a `ws:` id.

It renders **only when the pinned tier is empty** *and* a `workspace-folder`
drag is active. Rendering it whenever a folder drag is active would create two
overlapping eject targets (itself and the pinned groups) whose nearest-center
resolution is arbitrary. Because it is the sole eject affordance in the
empty-tier case it needs real geometry, not a zero-height hairline: a labelled
drop area with an explicit min-height and the standard drop indicator.

### D5 — `handleDragEnd` restructure: per-active-type dispatch

The `activeType !== overType` early return is **removed** and replaced by
per-branch guards, so every shipped gesture keeps its exact current code path:

```
  switch (activeType):
    "session"          → if (overType !== "session") return;   … unchanged
    "workspace"        → if (overType !== "workspace") return; … unchanged
    "pinned-group"     ┐
    "workspace-folder" ┘→ resolveFolderMove(...)
```

`resolveFolderMove` is keyed on the **(active, over) pair** — the earlier
"over is a pinned group → eject" rule was wrong, because it hijacked the shipped
pinned-group reorder:

| active | over | result |
|---|---|---|
| `pinned-group` | `pinned-group` | `{ kind: "reorder-pinned" }` → existing `reorder_pinned_dirs` |
| `workspace-folder` | `workspace-folder`, same `wsId` | `{ kind: "reorder-folders" }` → existing `reorder_workspace_folders` |
| `workspace-folder` | `workspace-folder`, other `wsId` | `{ kind: "move", index: target.folders.indexOf(overId) }` |
| `pinned-group` | `workspace-folder` | `{ kind: "move", index: … }` |
| either | `workspace-header` | active already in that ws → `null`; else `{ kind: "move" }`, no index |
| `pinned-group` | `workspace-folder` of a ws the active already belongs to | `null` |
| `workspace-folder` | `pinned-group` \| `pinned-tier` | `{ kind: "move", toWorkspaceId: null }` |
| any | own slot | `null` |

The **own-header → `null`** rule matters: without it, dropping a folder on its
own workspace's header detaches and re-appends it, silently jumping it to the
bottom and broadcasting — a mutation on what looks like a no-op.

Guards: an unknown `over.wsId` (stale render) resolves to `null` rather than
dereferencing an undefined workspace. The membership pre-check applies to *both*
header and folder targets — pinning and membership are orthogonal, so a pinned
directory can legally already be a member of the workspace it is dropped into;
without the check the client burns a round-trip on a request the server rejects.

### D6 — Spring-load: the open-Set and the timer are cleared on different events

The ambiguity worth naming: if `springOpen` were cleared whenever `over.id`
changes, then the instant the cursor moves from the header into the workspace's
just-revealed children, it would re-collapse — unmounting the folder droppables,
reverting `over`, re-arming the timer: a flicker loop.

So the two pieces of state have **different lifetimes**:

| State | Armed | Cleared |
|---|---|---|
| dwell timer (ref) | `onDragOver` on a collapsed `workspace-header` | the resolved **workspace** changes; drag end/cancel |
| `springOpen: Set<wsId>` | timer fires | **drag end/cancel only** (add-only during a drag) |

The timer is keyed on the **workspace id**, not the raw `over.id`. `closestCenter`
flips its resolved target at Voronoi cell boundaries, so a pointer dwelling near
a header/folder edge would jitter `over.id` and re-arm a 600 ms timer that never
completes. Keying on the workspace means jitter *within* one workspace's targets
leaves the timer running.

Render precedence, stated so it's total rather than accidentally exclusive:

```
  displayCollapsed = springOpen.has(ws.id) ? false
                   : (forceCollapsed.has(ws.id) || ws.collapsed)
```

The sets cannot intersect in practice (`forceCollapsed` is populated only for
`workspace` actives, `springOpen` only for folder-like ones), which preserves
the shipped drag-collapse behavior untouched. Neither ever emits
`set_workspace_collapsed`. Dwell = 600 ms, a named constant.

### D7 — No optimistic UI

Every existing sidebar drag is broadcast-driven; membership moves follow suit.
The latency is a localhost WebSocket round-trip, and optimistic state would
require a rollback path for the D1 rejection with no user-visible win.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Loosened collision detection lets a session card land on a workspace | Matrix + per-branch guard in `handleDragEnd` + an explicit spec scenario |
| Spring-load may never arm — a neighbouring *expanded* workspace's folder cards can be closer to the cursor than a collapsed workspace's center | Accepted. The header droppable (D4) is small and sits under the cursor, which is the common case; spring-load is an accelerator, not the only path — the user can also click to expand and drop positionally |
| Spring-load mounts `SortableWorkspaceFolder` droppables **mid-drag**; dnd-kit must remeasure newly-registered containers or a drop inside the revealed body could resolve to a stale target | Verify the `DndContext` measuring config (`MeasuringStrategy.Always`/`WhileDragging` for droppables) as an explicit implementation task — the default `Optimized` strategy may not remeasure. If remeasurement cannot be made reliable, spring-load is cut rather than shipped half-working |
| A stale client can compute `index` against an out-of-date folder list (second browser, mid-broadcast), landing the folder one slot off — unlike `reorderWorkspaceFolders`, the move path has no set-equality validation to reject it | Accepted. The failure is a wrong *position*, never a wrong *membership* or a lost folder, and the next broadcast reconciles every client. Adding an expected-state token would be a protocol-wide change |
| Off-by-one on cross-workspace insert | `resolveFolderMove` is pure and unit-tested beside the existing resolvers; cross-workspace `index` is computed against an array the detach never touches. Same-workspace moves — where a post-detach splice *would* be off by one — are rejected by the store (D1) |
| Eject skips directory discovery | D2 extracts `pinDirectorySideEffects` and shares it; covered by a server test asserting `onDirectoryAdded` runs on eject |
| Canonicalization asymmetry between `pinDirectory` (caller-canonical) and `addFolderToWorkspace` (self-canonical) | Handler passes the canonical form to both; store canonicalize is idempotent |
| A pinned directory dragged into a workspace stays in `pinnedDirectories`, so deleting that workspace makes it resurface in the pinned tier | Accepted — pinning and membership are orthogonal by design and this exactly matches shipped `add_folder_to_workspace`. Changing it would be a separate behavior change |
| A pinned group dragged *past* a workspace can now land in it, where before only pinned targets were reachable | Accepted — `over` resolves at release, not on pass-through, and the drop indicator shows the target before the user lets go |
| Removing a shipped spec scenario | Explicit `## REMOVED Requirements` block with reason + migration |

## Open Questions

- Should ejecting land the folder at the *hovered* pinned group's position
  rather than appending? Deferred — needs a second `reorder_pinned_dirs`
  message, reintroducing the two-message problem D1 avoids.
- Making unpinned directory rows draggable (auto-pin on drop into a workspace)
  is a natural follow-up, deliberately out of scope here.
