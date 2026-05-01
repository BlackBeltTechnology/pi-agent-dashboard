## Context

The pre-change sidebar exposed two toggles (`Active only`, `Show hidden`) and no search. Two problems compounded:

1. Finding a specific past session required flipping `Show hidden` ON or `Active only` OFF, which dumped every ended/hidden session in every workspace into the list at once.
2. The persisted drag-reorder list (`sessionOrder`) included ended session ids. When ended sessions were unhidden, they snapped back into their drag-reordered slots and interleaved with active ones, breaking the user's "current work first" mental model.

This change reorganises the sidebar around two primitives: a sidebar-level two-input search (folder filter + session search) and per-folder collapsible ended-session groups. Drag-reorder is restricted to alive sessions; dragging an ended card onto an alive one auto-resumes it.

The implementation iterated heavily during verification — the original design (per-folder search inputs, search bypasses both toggles, per-session pinning) was rejected through user feedback in favour of the simpler shipped model. The full iteration history is captured in the surrounding `pin-and-search-sessions` change directory; this design document reflects only the **shipped** behaviour.

## Goals / Non-Goals

**Goals:**

- Two-input sidebar search (folder + session) that composes with AND-logic.
- Per-folder collapsible ended-session group so ended work stays one click away without dominating the sidebar.
- Drag-reorder behaves as users expect: ended sessions drop to the bottom on transition; alive sessions persist their drag-reordered position; dragging an ended card into the alive zone auto-resumes it at the dropped position.
- Default sidebar shows pinned folders + any unpinned folder containing alive work, hiding stale unpinned-only-ended folders.

**Non-Goals:**

- Per-session pinning. Originally proposed but scrapped during iteration: once the collapsible-ended group landed, the user no longer needed a separate "this session is important" affordance.
- Cross-folder global search. The search composes over folders, not session contents, and remains workspace-aware.
- Fuzzy matching. Substring `includes()` against the session display name is sufficient and predictable.
- Search inside message bodies.
- Replacement of any existing WebSocket message type. The change reuses `sessions_reordered` and `resume_session` rather than introducing new ones.

## Decisions

### D1. Two sidebar-level inputs (`Folder…` + `Session…`), AND-composition

Both inputs live in the sidebar header, side-by-side with `Show hidden` toggle and the pin-folder button. Inputs are uncontrolled `<input type="search">` elements with state in `SessionList`. AND-composition: when both are non-empty, only folders matching the folder filter AND containing matching sessions are visible.

**Alternatives considered:**

- **Per-folder search inputs (original design):** Rejected during verification — placing the input inside each folder body cluttered the sidebar visually, made the search context unclear when many folders were collapsed, and produced confusing toggle interactions ("why does Active only still apply when I'm searching?"). Sidebar-level inputs make the search a global mode the user explicitly enters.
- **Single global search box:** Rejected — folder filter and session search compose differently (folder narrows folder set; session narrows sessions inside folders). One input couldn't express both axes without modal complexity.
- **OR-composition:** Rejected — produces noisy results ("show me all folders matching X OR all sessions matching Y" almost never matches user intent).

### D2. Single visibility toggle (`Show hidden`)

The pre-change `Active only` toggle is removed. `Show hidden` is the only filter chip in the header, controlling visibility of `hidden = true` sessions.

The role formerly played by `Active only` (keeping ended sessions out of the way) is now handled by the per-folder collapsible ended-session group: ended sessions stay in their folder but collapse below a `N ended` toggle row, accessible in one click. This removes the toggle-driven "where did my ended sessions go?" confusion entirely.

**Alternatives considered:**

- **Keep both toggles:** Rejected — once the collapsible-ended group landed, the toggle was redundant and produced inconsistent state (toggle says one thing, ended group inside a folder says another).
- **Drop both toggles, move hidden management to a dialog:** Rejected — surfacing a hidden session would require two clicks instead of one.

### D3. Server prunes `sessionOrder` on alive→ended transition; client trusts it

> **Follow-up (2026-04-29): preserve-session-order-on-reboot.** This change introduced a side-effect in the `onChange` ended→alive direction (insert + broadcast) that fires on every transition, including bridge auto-reattach during dashboard reboot. The reattach path is not user-driven and must not mutate the persisted order. The follow-up gates the ended→alive branch behind an explicit user-resume intent registry (`pendingResumeIntentRegistry`); only Resume clicks, REST resumes, and drag-to-resume tag the intent. Bridge reattach finds nothing tagged and returns early. See `openspec/changes/preserve-session-order-on-reboot/`.

The pre-change behaviour kept ended session ids in `sessionOrder`, causing them to retain their drag-reordered slots. The fix is server-side: in `server.ts`, the `sessionManager.onChange` hook detects the alive→ended transition (via a `Set<sessionId>` tracking last-known-ended state to fire exactly once), removes the id from `sessionOrder`, and broadcasts `sessions_reordered`.

The client trusts the server: the folder render reads `sessionOrder` verbatim and does not filter ended ids out itself. This means an ended id appearing in `sessionOrder` is a meaningful signal — it got there because the user explicitly drag-reordered an ended card into the alive zone (drag-to-resume, see D5).

**Alternatives considered:**

- **Client-side filter (strip ended ids in folder render):** Rejected — would have prevented drag-to-resume from preserving the dropped position, since the client filter would always strip the ended id before rendering. Server-side prune-on-transition keeps the persistent state truthful.
- **Re-prune on every onChange (not just transition):** Rejected — caused ended cards to visibly jump to the tail of the ended group every time the user clicked or interacted with them, because the `update()` call would re-fire the prune even when no transition occurred.

### D4. Per-folder collapsible ended-session group

Inside each folder, ended sessions render below alive sessions in a group that's collapsed by default. The bottom of the folder shows a `N ended` toggle row; clicking expands the group. When expanded, a second `Hide ended` toggle appears at the top of the ended group, and the bottom toggle remains — both clickable to collapse. While either filter input is non-empty, all visible folders auto-expand so search results are reachable.

**Alternatives considered:**

- **Top toggle only:** Rejected during verification — when the user expanded a long ended group, they had to scroll back up to collapse. Bottom toggle stays visible after the user has scanned the group.
- **Bottom toggle only:** Rejected — when the user is reading the alive sessions and wants to hide the expanded ended group below, walking the cursor down past every ended card is friction. Top toggle gives an immediate close.

### D5. Drag-to-resume an ended session

> **Follow-up (2026-04-29):** the intent-tagging fix described under D3 explicitly preserves the drag-to-resume invariant from this section — the `if (!order.includes(sessionId))` guard inside the branch keeps the dropped slot when the user pre-placed the id via `reorder_sessions`. The new gate runs *before* this guard, so user-tagged drag-to-resume reaches the guard intact, while bridge reattach short-circuits earlier.

Dragging an ended session card onto an alive card in the same folder triggers two effects in sequence: (1) `reorder_sessions` persists the new drag-reorder including the ended id at the drop position, (2) `resume_session` fires in `continue` mode for the dragged session. The dropped position survives the resume round-trip because the server-side prune (D3) only fires on the alive→ended direction — once the resumed session flips back to alive, it stays at the dropped slot.

The drop target is "any alive card in the same folder", not a dedicated drop zone. This was iterated through verification:

**Alternatives considered:**

- **Dedicated drop zone (`Hide ended` button as drop target):** Rejected — required the user to expand the ended group first, then drag back up to a button, which felt awkward. Targeting any alive card matches the user's intuition of "promote this session back to active by placing it where I want it."
- **Drop ended onto ended triggers resume:** Rejected — within the ended group, drag is ordinary reorder (no resume). Resume requires explicit promotion across the alive/ended boundary.

### D6. Default-view rules for unpinned folders

Pinned folders always appear. Unpinned folders appear when (a) they contain at least one alive session, or (b) the user typed something into `Folder…`. Unpinned folders containing only ended sessions stay hidden by default, keeping the sidebar focused on workspaces with current work.

When the user types into `Session…` while `Folder…` is empty, only **pinned** folders are searched. Cross-cwd session search requires explicit opt-in via `Folder…`.

**Alternatives considered:**

- **Always show all folders:** Rejected — produces a long sidebar dominated by folders the user no longer cares about.
- **Always limit to pinned in search:** Rejected — sometimes the user wants to find a session in a folder they haven't pinned yet. Folder filter unlocks that path.
- **Search always includes unpinned:** Rejected — produces noisy results from every cwd the user has ever opened.

### D7. Display-name-aware session search

`Session…` matches against the same string the user sees on the card, falling back through `name` → `firstMessage` → `cwd` basename (mirroring `getSessionDisplayName`). This means a session displayed as "pi-shodh" (because name and firstMessage are empty) matches a `pi-sho` query.

**Alternatives considered:**

- **Match `name` and `firstMessage` only:** Rejected during verification — the user typed the visible card title (`pi-shodh`) and got no results because the underlying fields were empty. "What you see is what you search" is the only consistent rule.
- **Match against `cwd` directly:** Rejected — that's the role of `Folder…`. Session search and folder filter must remain orthogonal.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| **Unpinned folder hides on its last alive session ending** — the user might lose track of a folder they were working in. | Bottom-of-sidebar `N hidden` count + `Show hidden` toggle remain. Folder reappears as soon as any session there transitions back to alive (e.g. via drag-to-resume on its ended sessions if the folder is filter-revealed). |
| **Drag-to-resume requires precise drop on an alive card** — if the user drops on the gap between alive and ended, nothing happens. | Acceptable; matches dnd-kit's grain. The bottom drop-zone-style affordance was rejected during iteration as more confusing than helpful. |
| **`sessionOrder` divergence between server and client** — if the prune broadcast is missed, the client could keep an ended id in its local order. | Belt-and-braces: the prune fires on every alive→ended transition AND the client re-syncs the order on every WS reconnect via the existing initial-state replay. |
| **Search input gets typed into rapidly** — filtering an entire sidebar's worth of sessions on every keystroke. | Filtering is `O(n)` over already-filtered `group.sessions`, ~µs in practice. No debounce needed at typical session counts. |
| **`Show hidden` ON + many hidden sessions across folders** — sidebar becomes long. | Same as before this change; `Show hidden` is opt-in and used when the user is explicitly managing hidden sessions. |

## Migration Plan

No persistence migration required. Existing users will see:
- The `Active only` toggle is gone.
- All their alive sessions appear in their folders as before, with ended sessions in a collapsible group below.
- Drag-reorder for alive sessions persists; ended sessions in the persisted order from prior drags will be pruned on the next alive→ended transition (or on the next time the server boots and the order is reconciled).

Rollback: the file changes can be reverted in place. The persistence layer was not modified by this change (no new keys in `preferences.json`), so no data cleanup is needed if the rollback happens.

## Open Questions

None remaining. All in-flight questions from the iteration were resolved through the verification rounds and folded into the decisions above.
