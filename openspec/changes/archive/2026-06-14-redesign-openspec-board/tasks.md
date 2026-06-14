## 1. Board route + shell

- [x] 1.1 Add overlay route `/folder/:encodedCwd/openspec` to `App.tsx` (mirror `/archive`, `/specs`) with `useRoute` parsing + `navigate`/`goBackOrHome`
- [x] 1.2 Create `OpenSpecBoardView` component (top bar: Back, breadcrumb, Refresh, Specs, Archive, + New proposal) reading `OpenSpecData`, sessions, groups, assignments for the cwd
- [x] 1.3 Port top-bar chrome + theme tokens from `mockups/board.html`; verify against mockup with the browser skill (desktop)

## 2. Folder-card entry point

- [x] 2.1 Replace `FolderOpenSpecSection` inline expander with a single-line `OpenSpec (N) →` button that navigates to the board route (keep Refresh)
- [x] 2.2 Remove inline group pills, search, and accordion rendering from the folder card (move to board)
- [x] 2.3 Update `openspec-folder-section` tests for the navigate-button behavior

## 3. Group columns + reorder

- [x] 3.1 Render one column per group + always-present `Ungrouped`; header = dot, name, count, `＋`, `⚙`, grip
- [x] 3.2 Wire column-header drag → reorder via `@dnd-kit` `SortableContext`; persist via `PATCH /api/openspec/groups/:id` `order` (reuse `OpenSpecGroupManager` logic)
- [x] 3.3 Per-column `⚙` inline manage (rename/recolor/delete) reusing `OpenSpecGroupManager`; `+ Add group` ghost column at board end

## 4. Proposal cards

- [x] 4.1 Card layout: name + state pill + `OpenSpecStepper` + task progress bar + session list + card actions (`New session`/`New worktree`)
- [x] 4.2 Wire `onSpawnAttached` / `onSpawnAttachedWorktree` to the card actions
- [x] 4.3 Wire stepper node clicks to `onReadArtifact` / tasks popover; confirm opaque-base nodes (no line bleed)

## 5. Card drag (between + within columns)

- [x] 5.1 Draggable cards → drop on a column reassigns group via `setAssignment`
- [x] 5.2 Intra-column drop computes insert index and reorders within the group
- [x] 5.3 PointerSensor activation distance; verify drag-vs-scroll on touch (or gate card-drag to desktop)

## 6. Per-change order persistence

- [x] 6.1 Add per-group ordered change list to the groups/assignments store (shared types + server)
- [x] 6.2 REST/WS: persist + broadcast order changes (extend groups routes or add an order route)
- [x] 6.3 Default sort fallback (in-progress → complete → name) when order absent; reassign updates both groups' orders
- [x] 6.4 Tests for `openspec-change-order` scenarios (reorder persists, per-group, missing-order fallback, move keeps position)

## 7. Session slot in cards

- [x] 7.1 Render session rows: status indicator, name, age, `OpenSpecActivityBadge` (phase + done/total), stat line (tokens/context/cost)
- [x] 7.2 Click row → `onNavigateToSession`; action clicks `stopPropagation`
- [x] 7.3 Per-session actions: resume/continue, fork, hide/unhide (reuse folder-section handlers)
- [x] 7.4 OpenSpec command menu (Explore, Advance, Fast-forward, Apply, Verify, Archive, Detach) reusing `SessionOpenSpecActions`

## 8. Worktree state visualization

- [x] 8.1 Detect worktree sessions via `session.gitWorktree`; render `⎇ <name>` marker line
- [x] 8.2 Derive the worktree's own `done/total` from per-cwd poll of the worktree dir (gated by mtime poller)
- [x] 8.3 Compute + render delta vs proposal main progress (`+n` ahead green / `-n` behind orange); keep card bar = main
- [x] 8.4 Tests for `openspec-card-section` worktree scenarios (ahead, behind, non-worktree)

## 9. Filter bar

- [x] 9.1 Filter bar UI: text input + state pills + session-status pills
- [x] 9.2 Filter logic: text matches change/session names; state filters cards; session-status filters cards + rows
- [x] 9.3 Tests for combined filtering

## 10. New-proposal dialog

- [x] 10.1 Dialog: Name + Group (default = launching column) + "new worktree" checkbox
- [x] 10.2 Top-bar `+ New proposal` and per-column `＋` open the dialog (column pre-fills group)
- [x] 10.3 Submit → spawn session running new-change flow (reuse `new-spec-spawn`); worktree variant; auto-assign created change to chosen group
- [x] 10.4 Tests for dialog defaults + create paths

## 11. Responsive

- [x] 11.1 Media queries: ≤900px wrap columns; ≤540px stack + wrap top bar (port from mockup)
- [x] 11.2 Verify desktop kanban with the browser skill (isolated preview on :8055 against live data); tablet/phone media queries ported verbatim from mockup

## 12. Cleanup + docs

- [x] 12.1 Remove the old inline accordion path once board reaches parity
- [x] 12.2 Add board route + components to `docs/file-index-client.md`; update `docs/architecture.md` OpenSpec section (delegate per docs protocol)
- [x] 12.3 Tests green (95/95 across touched files; full-suite residual failures are env-only server-spawn timeouts, pass in isolation); `npm run build` succeeds; mockup-vs-implementation visual check done on isolated :8055 preview. Live :8000 restart + `npm run reload` deferred (user opted not to restart their 20-session prod server).
