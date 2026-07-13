## Context

`packages/client/src/components/SessionList.tsx` renders one block per directory group. Today the only compaction control is `collapsedGroups` (a `Set<cwd>` persisted to localStorage by `getCollapsedGroups`/`setCollapsedGroups` in `packages/client/src/lib/session-filter-storage.ts`). The chevron toggles membership in that set, and the per-group render branches on `isFolderCollapsed(cwd)` to either show all session cards or none. Since `condense-collapsed-folder-header` (archived 2026-07-07), collapsed folders already hide heavy header slots (`GroupGitInfo`, `FolderActionBar`, `SidebarFolderSectionSlot`, `FolderOpenSpecSection`, `FolderSpawnButtons`) behind `{!isCollapsed && ...}` — the collapsed header is compact, showing only folder name + `FolderNeedsYouPill` + `FolderStatusRollup`. This proposal's focus-driven model adds compact render modes for *unfocused* folders on top of this already-compact collapsed state.

Sessions in `packages/shared/src/types.ts` already carry every field needed to derive an attention signal:
- `status: "active" | "idle" | "streaming" | "ended"`
- `currentTool?: string` — equals `"ask_user"` while an interactive prompt is open
- `unread?: boolean` — server-managed bit set on attention-worthy events (see change `session-card-unread-stripes`)

The proposal introduces a focused-folder model layered on top of the existing chevron toggle, **gated behind an opt-in global setting `config.folderListMode` (default `"classic"`)**. Classic mode = today's behavior verbatim; Accordion mode enables the focus-driven render branch. One additive server-config field; no protocol/message-shape change and no new persisted Session field. The only new client persistence is an opt-in user-expanded set; the focused-folder identity itself is ephemeral component state.

**Mode gating (Classic is default):** `renderGroup` reads `folderListMode` from config. When `"classic"`, the whole focus-driven branch is skipped and the existing `isFolderCollapsed`-based render runs unchanged — zero behavioral drift for users who never opt in. When `"accordion"`, `resolveGroupRenderMode(...)` governs the four render modes. A secondary `config.folderAttentionPeek` (default `true`) chooses, in Accordion mode, whether unfocused folders show attention cards (`true` → `compactWithAttention`/`compactEmpty` per the table) or always collapse header-only (`false` → force `compactEmpty`). Settings surface: `SelectField` + nested `ToggleField` on Settings → Sessions; see `mockups/accordion-setting.html`.

## Goals / Non-Goals

**Goals:**
- Inactive folders shrink to header + only attention-demanding session cards.
- At most one folder is "focused" at any time; selecting a session anywhere auto-focuses its folder.
- Folder-header click focuses the folder without flipping the chevron toggle.
- The chevron retains its current contract for the focused folder (and for any folder the user has explicitly pinned open via the user-expanded override).
- Pure, well-tested derivation: `demandsAttention(session)` and `resolveActiveCwd(...)` live in helper modules with unit coverage.
- Same rules apply to pinned and unpinned (Other) groups.

**Non-Goals:**
- No animation work beyond what `group-collapse` CSS classes already provide. The compact form is just a different render branch — no new transitions.
- No change to which sessions appear *inside* a folder (status/search/hide filters stay as-is). The new filter is a strictly narrower view applied only when the folder is unfocused.
- No mobile-shell rework. Mobile uses the same `SessionList`; rules apply uniformly.
- No server-side state. `activeCwd` is not synced across browser tabs.
- No reordering of folder groups based on focus. Pinned-dir order, group order, and session order all remain unchanged.

## Decisions

### Decision 1: Single-source `activeCwd` derivation

Compute `activeCwd` inside `SessionList` as a `useMemo` over three inputs:

1. The cwd of the currently selected session (`sessionMap.get(selectedId)?.cwd`), if any.
2. The most recent folder-header click (new `lastFocusedCwd` local `useState<string | null>`).
3. Fallback: `null` (nothing focused).

Precedence: **selection beats click**. Rationale — selection is a stronger user intent than a stray header tap, and avoids the case where clicking another folder mid-conversation orphans the session you're reading.

```mermaid
flowchart LR
    S[selectedId] -->|sessionMap.get| Csel[selected.cwd]
    L[lastFocusedCwd state] --> R{resolveActiveCwd}
    Csel --> R
    R --> A[activeCwd: string | null]
```

`resolveActiveCwd(selectedId, lastFocusedCwd, sessionMap)` is extracted to `packages/client/src/lib/folder-focus.ts` as a pure function with unit tests covering: selected session present, selected session absent (e.g. just removed), no selection + click present, neither present, click pointing at a cwd that no longer has any group.

**Alternatives considered:**
- *Click beats selection.* Rejected — surprises the user during streaming when their attention is on the active session.
- *Track focus per-route.* Rejected — sidebar selection already drives route changes; this would double-store the same intent.

### Decision 2: Header click ≠ chevron click

The folder header today binds `onClick={() => handleToggleCollapse(group.cwd)}` on the entire header `div`. We split:

- **Chevron region** (the `▸ / ▾` icon button): toggles `collapsedGroups` (existing behavior, unchanged).
- **Header body** (everything else): sets `lastFocusedCwd = group.cwd`. Does NOT change `collapsedGroups`.

The chevron handler must `e.stopPropagation()` to prevent the header-body listener from also firing. The header-body click is a no-op when the folder is already focused.

**Alternatives considered:**
- *Make any header click both focus and toggle.* Rejected — would force users to click twice (once to focus, once to expand) for any non-focused folder, defeating the point.
- *Add a separate "focus" affordance.* Rejected — the header already feels clickable; extra UI is noise.

### Decision 3: Attention predicate is purely derived

```
demandsAttention(session) =
     session.currentTool === "ask_user"
  || session.status === "streaming"
  || session.status === "active"
  || session.unread === true
```

Lives in `packages/client/src/lib/folder-focus.ts` next to `resolveActiveCwd`. No state. Re-runs on every `SessionList` render. Reactivity is automatic — the moment the server clears `unread` (or a session ends streaming, or `currentTool` changes), the next render drops the card from unfocused folders.

**`status === "active"` rationale**: in the existing taxonomy, `"active"` means a tool is mid-execution but no model stream is open. That still warrants visibility in an unfocused folder (something is happening). `"idle"` and `"ended"` do not.

### Decision 4: User-expanded override (additive, opt-in)

A second localStorage key `folder.userExpanded` mirrors the existing `folder.collapsed` shape (`Set<cwd>` serialized as JSON array). When `cwd ∈ userExpanded`:
- The folder renders in expanded form (full session list) regardless of focus.
- The chevron icon flips and a click removes it from the set.

The new helper module is `packages/client/src/lib/user-expanded-groups.ts` mirroring the collapsed-group helpers in `session-filter-storage.ts` (get/set/prune). The two sets are independent; if a cwd appears in both, `userExpanded` wins (explicit user intent to keep open).

**Alternatives considered:**
- *Reuse `collapsedGroups` with a tri-state (collapsed/auto/expanded).* Rejected — invalidates existing localStorage payloads on rollout and complicates the prune helper.
- *Hold focus to pin (long-press).* Rejected — discoverability problem; mobile/desktop divergence.

### Decision 5: Render-rule decision table

For each group, compute `mode ∈ {expandedFull, expandedToggleHidden, compactWithAttention, compactEmpty}`:

| `cwd` is focused? | in `collapsedGroups`? | in `userExpanded`? | mode |
|---|---|---|---|
| any | any | yes | `expandedFull` |
| yes | no | no | `expandedFull` |
| yes | yes | no | `expandedToggleHidden` |
| no | any | no, attention exists | `compactWithAttention` |
| no | any | no, no attention | `compactEmpty` |

Encoded as a pure helper `resolveGroupRenderMode({focused, collapsed, userExpanded, hasAttention}) → GroupRenderMode` so component tests can hit all five rows without mounting the full tree.

**Note (2026-07-13 drift reconciliation)**: The compact modes (`compactWithAttention`, `compactEmpty`) are purely additive — they apply only to unfocused folders outside `userExpanded`. Focused folders keep today's `expandedFull` and `expandedToggleHidden` behaviour unchanged. "Today's behaviour" already includes the compact collapsed-header shipped by `condense-collapsed-folder-header` (heavy slots hidden via `{!isCollapsed && ...}`). The mode matrix adds a new layer on top without altering existing collapse semantics.

### Decision 6: Compact form keeps the existing header

The compact form for an unfocused folder reuses today's header DOM (folder name, count, pin, `GroupGitInfo`, readme button, `FolderActionBar`, `SidebarFolderSectionSlot`, `FolderOpenSpecSection`). We do NOT shrink the header — only the session-card region changes:

- `compactWithAttention` → renders `<div className="space-y-1 pt-1">…attention cards…</div>`. Cards reuse `<SortableSessionCard>` so drag-to-reorder still works (only attention cards are draggable in this view; rest are hidden).
- `compactEmpty` → renders a single subdued affordance row: `"N sessions — click to view"` styled like the existing "Show N ended" footer button. Click sets `lastFocusedCwd` (does not change collapse state).

**Drift note (2026-07-13)**: `condense-collapsed-folder-header` already made the COLLAPSED-folder header compact — heavy slots (`GroupGitInfo`, `FolderActionBar`, `SidebarFolderSectionSlot`, `FolderOpenSpecSection`, `FolderSpawnButtons`) are hidden behind `{!isCollapsed && ...}`. This Decision describes the UNFOCUSED (but not collapsed) header, which keeps all slots. The two concepts (collapsed = old binary toggle, unfocused = new attention-driven mode) are orthogonal; both now have compact forms.

**Rationale**: keeping the header constant avoids layout thrash when a folder gains/loses focus; only the body region animates.

**Alternatives considered:**
- *Hide `FolderActionBar` / `FolderOpenSpecSection` when unfocused to save more space.* Rejected — they ARE the affordances users want to reach without focusing first (spawn, archive, terminals). Hiding them defeats the point.

### Decision 7: Drag-to-reorder interaction with hidden cards

When a folder is in `compactWithAttention`, only attention-demanding cards are in the DOM, so they're the only drop targets. We accept this constraint: drag-to-reorder for non-attention sessions requires focusing the folder first. The session-order persistence is unaffected because reorder operates on the rendered IDs and the server stores the full order independently.

### Decision 8: Force-focus on programmatic selection changes

When `selectedId` changes (e.g. routing into a session, replay completion, drag-to-resume), the derivation in Decision 1 already re-runs. No imperative effect needed. We only fire an effect to *clear* `lastFocusedCwd` if it points at a cwd that no longer has any visible group — prevents stale focus when a folder loses all sessions.

## Risks / Trade-offs

- **[Risk] Clicking through accordion feels janky if the previous folder collapses immediately.** → Mitigation: the existing `group-collapse expanded/collapsed` CSS handles transitions. The compact-form switch IS a layout change, so we add a single CSS class swap rather than animating each card; reuse the existing transition.
- **[Risk] Users who relied on collapse-toggle to "hide a folder I don't care about" will see attention cards reappear.** → Mitigation: `unread === true` requires server-side activity, and `ask_user`/`streaming` states are inherently temporary. The compact form IS the "I don't care unless something happens" view they actually wanted. Document in CHANGELOG.
- **[Risk] `lastFocusedCwd` stored only in component state — lost on full client reload.** → Mitigation: this is intentional. After reload, focus falls back to the selected session's cwd (which IS persisted in the URL). No need to persist the click.
- **[Risk] Unfocused folder accumulates many attention cards if many sessions stream at once.** → Mitigation: each card is the same height as before; the worst case is no worse than today's expanded view. Acceptable.
- **[Risk] User-expanded set could accumulate stale entries.** → Mitigation: reuse the existing `pruneStaleCollapsedGroups` pattern as `pruneStaleUserExpanded`; call it from the same effect on session-list change.
- **[Trade-off] Drag-to-reorder limited to attention cards in compact view.** → Acceptable; users who want to reorder typically focus the folder anyway.
- **[Trade-off] Header height unchanged when compacting.** → Acceptable; compactness gain comes from removing N session cards, which dominates header height.

## Open Questions

- Should the "N sessions — click to view" affordance link to expand-without-focus (i.e., add to userExpanded) instead of focus? Current proposal: focus-only; userExpanded is reachable via the chevron once focused.
- Should `compactWithAttention` cap the number of cards shown (e.g. max 5)? Defer until we observe pathological cases in practice.
- **Chevron cannot distinguish `expandedFull` causes.** `expandedFull` is reachable three ways (focused+not-collapsed, `userExpanded`, filter-active), all rendering the same down-chevron — a *pinned-open* folder and a *focused* folder look identical, so the user cannot tell why a folder is open. **Punt (2026-07-13):** ship with the shared icon; if user confusion surfaces, add a distinct pinned-open affordance (e.g. a small pin glyph on `userExpanded` folders) in a follow-up. Not blocking.
- Mobile single-pane layout already shows one folder/session at a time; the focus model is moot there. We keep the rules identical for code simplicity, but the visible benefit is desktop-only.
