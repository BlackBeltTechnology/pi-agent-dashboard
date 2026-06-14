## Context

`FolderOpenSpecSection` renders the OpenSpec UI as an inline collapsible accordion inside the folder card. With dozens of changes it is cramped; group management hides in a modal; per-session OpenSpec actions are partial. The dashboard already has: overlay-route navigation (`/folder/:cwd/openspec/...`, `/archive`, `/specs`), `@dnd-kit` drag (change→group) and `SortableContext` group reorder (in `OpenSpecGroupManager`), persisted group `order`, `OpenSpecStepper`, `OpenSpecActivityBadge`, `SessionOpenSpecActions`, and `session.gitWorktree`. This change re-houses and re-lays-out those pieces as a full-page kanban board, adding two genuinely new bits: worktree state visualization and per-change ordering within a group.

The authoritative frontend design is `mockups/board.html` (see proposal). This document covers architecture/approach, not pixels.

## Goals / Non-Goals

**Goals:**
- Replace the inline accordion with a full-page board route reached from a single-line folder-card button.
- Group columns: horizontal kanban on desktop, wrap to rows on tablet, stack on phone.
- Reorder groups (column drag) and proposals (card drag) both between and within columns, persisted.
- Per proposal card: lifecycle stepper, task progress, session list with stats, worktree state + delta, and OpenSpec actions.
- Per session row: the session-card OpenSpec slot + resume/fork/hide + OpenSpec command menu.
- Filter bar (text + state + session-status) and a new-proposal dialog (name/group/worktree → create & spawn).

**Non-Goals:**
- The `extract-openspec-as-plugin` migration (this lands on the current tree).
- Changing OpenSpec polling, archive, or artifact-reader internals.
- New backend data sources beyond per-change order (worktree state is derived from existing per-cwd polling of the worktree dir + `gitWorktree`).

## Decisions

- **Full-page route over inline expand.** New overlay route `/folder/:encodedCwd/openspec`, consistent with `/archive` and `/specs`. The folder slot becomes a navigate button. Alternative (richer inline panel) rejected: width-constrained, doesn't scale to 60+ changes.
- **Columns = groups, reuse persistence.** Column order = existing group `order` via `PATCH /api/openspec/groups/:id`. Card→group = existing `setAssignment`. Only intra-column ordering is new. Alternative (new board-layout store) rejected: duplicates group persistence.
- **Per-change order within a group (NEW).** Store an ordered list per group (or a numeric `order` per assignment). Default when absent = current sort (in-progress first, then complete, then name). Drag within a column writes the new order. Chosen list-per-group keeps reorder a single write and avoids renumber storms.
- **Worktree state via existing polling.** A worktree session's `tasks.md` lives in its worktree dir, already pollable per-cwd. The card's progress bar = main checkout; the worktree marker shows the worktree's own `done/total` + delta vs main. Derivation is read-only; no new persistence.
- **Reuse components, don't fork the design.** Board maps to `OpenSpecStepper`, `OpenSpecActivityBadge`, `SessionOpenSpecActions`, `OpenSpecGroupManager`, `ArtifactLetters`, `@dnd-kit`. The mockup is ported, not re-derived.
- **New-proposal = dialog → spawn.** Name + group (defaults to launching column) + optional worktree. Create spawns a session running the new-change/explore flow (reuses `new-spec-spawn`); created change auto-assigns to the chosen group.
- **Responsive via media queries only.** ≤900px wrap columns; ≤540px stack + wrap top bar. Desktop kanban unchanged.

## Risks / Trade-offs

- **Rebase vs `extract-openspec-as-plugin`** → keep board files cohesive so the plugin move is a path rename, not a rewrite.
- **Overlap with `simplify-session-card-ordering`** (active, has a worktree) → coordinate session-ordering touch points before implementing.
- **Per-change order migration** → absent order falls back to the deterministic status-then-name sort; no destructive migration.
- **Worktree poll cost** → polling worktree dirs adds reads; gate behind the existing mtime-gated poller and only for cwds with active worktree sessions.
- **DnD on touch** → `@dnd-kit` PointerSensor with an activation distance; verify drag vs scroll on mobile, or gate card-drag to desktop and use the group picker on phone.

## Migration Plan

1. Add the board route + components behind the new folder-slot button; keep the old inline section until parity is verified.
2. Add per-change order persistence with safe default.
3. Verify against the mockup (desktop + phone) with the browser skill.
4. Remove the inline accordion once the board reaches parity.

## Open Questions

- Per-change order storage: numeric `order` on assignment vs ordered id-list per group? (Leaning ordered list.)
- Card drag on touch devices: enable, or fall back to the group picker on phone?
- Should the worktree delta compare against main `tasks.md` or against the merge-base snapshot?
