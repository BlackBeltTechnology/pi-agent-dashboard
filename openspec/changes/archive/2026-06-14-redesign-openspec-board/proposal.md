# redesign-openspec-board

## Why

The folder-level OpenSpec section (`FolderOpenSpecSection`) is an inline collapsible accordion inside the folder card. With 66 changes it is cramped, hard to scan, and mixes group management, proposals, and linked sessions in a vertical tree that fights the card's width. Group management hides in a modal; per-session lifecycle actions and the OpenSpec workflow are scattered or missing from that view.

This change replaces the inline accordion with a dedicated full-page **OpenSpec board** (kanban): groups become columns, changes become draggable proposal cards, and each card surfaces its lifecycle stepper, task progress, and the sessions working on it (including worktree state). Management and creation live on the board where the work is.

UX was steered interactively against a live mockup. **The mockup is the authoritative frontend design for this change** — not a sketch. Frontend implementation MUST port `openspec/changes/redesign-openspec-board/mockups/board.html` (layout, design tokens, component structure, states, and interactions) rather than re-deriving the UI. Deviations require updating the mockup first, then the implementation. Open it with `file://`.

Sequencing note: `extract-openspec-as-plugin` will later `git mv` `FolderOpenSpecSection` into `packages/openspec-plugin/`. Decision: **build this redesign on the current tree now**; treat the plugin extraction as a later rebase. The board is additive (new route + components) so the rebase surface is bounded to the slot entry point.

## What Changes

### Entry point
- The folder-card OpenSpec slot stops expanding inline. It becomes a **single-line button** `OpenSpec (N) →` that navigates to a new full-page board route `/folder/:encodedCwd/openspec` (overlay route, same pattern as `/archive`, `/specs`).

### Board layout
- **Columns = groups.** Each group renders as a 300px column; `Ungrouped` is always present as a column. Desktop: horizontal scroll (kanban). Tablet (≤900px): columns wrap to multiple rows. Phone (≤540px): columns stack full-width. Responsive via media queries.
- **Group reorder** by dragging the column-header grip; persists via the existing `order` field + `PATCH /api/openspec/groups/:id` (already supported).
- **Manage in a frequent place**: per-column header `⚙` (rename/recolor/delete that group) and `＋` (new proposal pre-filled to that group). Top bar carries `Refresh`, `Specs`, `Archive`, `+ New proposal`. A `+ Add group` ghost column sits at the board's end. The old "Manage groups" modal-from-card is removed.

### Proposal cards
- Card shows: **name + state pill** (`PLANNING`/`READY`/`IMPLEMENTING`/`COMPLETE`), the **OpenSpec lifecycle stepper** (reuses `OpenSpecStepper`: Explore→Proposal→Design→Specs→Tasks→Apply→Archive; green check = done, orange = current; Tasks node shows `done/total`; nodes click to open artifact/tasks), the **proposal task progress bar** (`done/total · %`, from the main checkout), then the **session list**, then card actions.
- **Card actions** per proposal: `▶ New session` (spawn attached) and `⑂ New worktree` (spawn attached in worktree) — the existing `onSpawnAttached` / `onSpawnAttachedWorktree` handlers.
- Cards are **draggable between columns** (reassign group — existing `setAssignment`) **and reorderable within a column** (NEW: persisted per-change order within a group).
- The stepper circle uses an opaque base with the tint layered as a gradient so the connecting line cannot bleed through the node interior (matches `OpenSpecStepper`'s existing fix).

### Session slot (rows inside a proposal card)
- Each session row renders the **session-card OpenSpec slot**: status dot (status-tinted), session name, age, the **phase chip** = `OpenSpecActivityBadge` (`phase` + `(completed/total)`), and a stat line (`tokens↑↓`, context bar, `$cost`).
- **Per-session actions** restored from the folder section: `↻` resume/continue, `⑂` fork, `⊘`/eye hide/unhide, and a `⋯` **OpenSpec commands** menu exposing `SessionOpenSpecActions` verbs (Explore, Advance phase, Fast-forward, Apply, Verify, Archive, Detach).
- Clicking a session row navigates to that session (chat view) — existing `onNavigateToSession`.

### Worktree visualization (NEW)
- A session whose cwd is a git worktree (`session.gitWorktree`) shows a **worktree marker line** (`⎇ <name>`). The worktree carries its **own** `tasks.md` state, which can differ from the proposal's main-checkout state. The marker shows the worktree's own progress (amber bar + `done/total`) and a **delta vs the proposal** (`+n` green = ahead, `-n` orange = behind). This is the only place worktree↔session is currently visualized.

### Filtering (NEW)
- A board **filter bar**: free-text (matches proposal names and session names), **state** pills (All/planning/ready/implementing/complete), and **session-status** pills (Any/Live/Waiting/Ended). Cards with no matching session hide under a session-status filter.

### New-proposal flow
- `+ New proposal` (top bar) and per-column `＋` open a **dialog**: Name, Group (defaults to the column's group when launched from a column), and a "Create in a new worktree (os/<name>)" checkbox. **Create & spawn** spawns a session running the new-change/explore flow; the created change auto-assigns to the chosen group (and worktree when checked).

## Capabilities

### New Capabilities
- `openspec-board`: full-page kanban board route (`/folder/:cwd/openspec`) with group columns, draggable/reorderable proposal cards, per-card lifecycle stepper + task progress, session slot with stats + per-session actions + OpenSpec command menu, worktree state visualization, filter bar, and new-proposal dialog. Replaces the inline accordion.
- `openspec-change-order`: persisted per-change ordering within a group (intra-column drag), alongside the existing per-group `order`.

### Modified Capabilities
- `openspec-folder-section`: the folder slot becomes a navigation button to the board route instead of an inline expander.
- `openspec-change-grouping`: group columns + header-grip reorder + per-column manage/add, replacing the pills/modal management UI. Existing groups REST/persistence reused.
- `openspec-card-section` / session slot: the session-card OpenSpec slot (`OpenSpecActivityBadge`, `SessionOpenSpecActions`) renders per-session inside proposal cards.

## Impact

- **Client** (`packages/client/src/`):
  - NEW board view component(s) + route wiring in `App.tsx` (`/folder/:encodedCwd/openspec`).
  - `FolderOpenSpecSection.tsx` — replace inline expander with a navigate-to-board button; move grouped/DnD rendering into the board view.
  - Reuse `OpenSpecStepper`, `OpenSpecActivityBadge`, `SessionOpenSpecActions`, `OpenSpecGroupManager`, `ArtifactLetters`, `DraggableChangeRow`, `@dnd-kit`.
  - NEW worktree marker + delta UI; NEW filter bar; NEW new-proposal dialog (name/group/worktree).
- **Server** (`packages/server/src/`):
  - Persist per-change order within a group (extend the groups/assignments store or add a change-order field). Reuse `/api/openspec/groups` for group order.
  - New-proposal spawn path = existing session-spawn + new-change flow (see `new-spec-spawn`); worktree variant reuses worktree-spawn.
- **Shared** (`packages/shared/src/`): types for per-change order; worktree progress/delta already derivable from `gitWorktree` + per-cwd OpenSpec poll of the worktree dir.
- **Tests**: board layout, DnD reorder (group + card), filter logic, worktree-delta derivation, new-proposal dialog, mobile wrap.
- **Docs**: add board route + components to the relevant `docs/file-index-client.md` rows; update `docs/architecture.md` OpenSpec section.

## Frontend Design Source (authoritative)

`openspec/changes/redesign-openspec-board/mockups/board.html` is the canonical frontend design for this change and ships as part of the spec. It is interactive and theme-faithful (uses the real `--bg-*`/`--text-*`/`--border-*` tokens) and encodes every decision above: board route chrome, group columns, column reorder, lifecycle stepper (opaque-base nodes, no line bleed), task progress, session slot (phase chip + stats + `↻ ⑂ ⊘ ⋯` actions + command menu), worktree marker with progress + delta, filter bar, new-proposal dialog, and responsive column wrapping.

Implementation rules:
- Port the mockup's structure and visuals into React components mapped to the existing tokens/components (`OpenSpecStepper`, `OpenSpecActivityBadge`, `SessionOpenSpecActions`, `OpenSpecGroupManager`, `@dnd-kit`). Do not invent a parallel design.
- The mockup's static `STATE` is illustrative only; real data comes from `OpenSpecData`, `DashboardSession`, groups/assignments, and `gitWorktree`.
- Any UX change during implementation updates `board.html` first (it stays the source of truth), then the code.
- Verify implemented screens against the mockup with the browser skill (desktop + phone widths). Phone framing: `/tmp/mobile-preview.html`.

## Migration Risks

- **Rebase vs `extract-openspec-as-plugin`**: that change moves these files into a plugin package. Keep the board's new files cohesive so the move is a path rename, not a rewrite.
- **Overlap with `simplify-session-card-ordering`** (active, has a worktree): coordinate session-ordering touch points.
- **Per-change order** is new persisted state — needs a default (status-then-name) and migration for existing assignments.
