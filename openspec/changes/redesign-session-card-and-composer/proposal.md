## Why

Today the session card mixes git and jj in one `WORKSPACE` subcard, hides OpenSpec workflow progression behind a single state pill, and renders the same action surface only in the sidebar — so users lose context the moment they focus the composer textarea. Selected-card emphasis is also flat (border + tint) which makes the active session blend into long lists. The 9-profile `ThemeProvider` already ships, but the card design doesn't take advantage of its accent variables to show *where in the OpenSpec lifecycle* a change sits, nor to give a selected card a recognizable identity.

## What Changes

- **Split `WORKSPACE` subcard into separate `GIT` and `JJ` subcards.**
  - `GIT` keeps branch / PR / worktree pill / `Push · Open PR · Merge · Close` actions.
  - `JJ` carries the `jj:<workspace>` pill / `Add workspace · Fold back · Forget` actions (plugin-claimed via the existing slot registry; no plugin manifest change).
  - Each subcard renders independently per its predicate (jj subcard hidden in pure-git repos, git subcard hidden in cwds with no `.git/`).
- **Add a pills+lines stepper to the `OPENSPEC` subcard.**
  - Seven nodes: `Explore → Proposal → Design → Specs → Tasks → Apply → Archive`, matching the spec-driven schema where `tasks` is blocked by both `design` and `specs`. Nodes connected by short progress lines.
  - Node states: `done` (filled, check or artifact letter), `current` (orange halo, slow 2.4 s pulse), `todo` (dim).
  - Current step derived from `ChangeState` + artifact presence + `completedTasks/totalTasks`.
- **Action gating in the `OPENSPEC` subcard.**
  - `Explore` button enabled **only when no proposal is attached** (detach first if you want a fresh explore).
  - `Archive` button enabled **only when a proposal IS attached** (and the change is in a terminal-ready state).
- **Clone the session action strip above the composer textarea.**
  - New strip sits between the existing model/level row and the textarea inside `CommandInput`.
  - Mirrors the per-session OpenSpec + Git + JJ action groups, plus a refresh button and a compact stepper.
  - Same action gating as the card so the user sees one source of truth.
- **Selected-card iridescent ring.**
  - Soft 4-stop conic gradient (blue → purple → pink → cyan), low alpha (rim 0.45 / glow 0.10 dark; 0.50 / 0.18 light), 13 s rotation, honours `prefers-reduced-motion`.
  - Replaces the current flat selected-card border tint; coexists with existing `card-working-pulse / card-input-pulse / card-unread-pulse` (z-index below them).
- **Migrate unicode-glyph-as-icon to MDI everywhere on the card and composer.**
  - Branch icon, paperclip, fork, play, refresh, archive, etc. all become `@mdi/react` icons. P/D/T/S artifact letters stay as letters (they're semantic identifiers, not glyphs).

**Not changed:**
- The 9 palette profiles (`Base, Dracula, Nord, GitHub, Catppuccin, Tokyo Night, Rosé Pine, Solarized, Gruvbox`) and their `Light/System/Dark` mode toggle ship as-is via existing `ThemeProvider` / `ThemePicker` / `themes.ts`.
- Plugin slot registry contract (`session-card-badge`, `workspace-action-bar`, `session-card-action-bar`, `session-card-memory`, `session-card-flows`) — JJ subcard keeps using `workspace-action-bar`; only the host container splits.
- OpenSpec `ChangeState` enum, action skill commands, and the `useOpenSpecActions` hook.

## Capabilities

### New Capabilities
- *(none)* — every change is a modification to existing specs.

### Modified Capabilities
- `session-card-subcards`: `WORKSPACE` subcard splits into independent `GIT` and `JJ` subcards with their own predicates and host containers; the `workspace-action-bar` slot now binds to the `JJ` subcard.
- `session-card-selection`: selected-card visual gains an animated iridescent ring (4-stop conic gradient, low alpha, 13 s rotation) layered above the existing blue tint; opt-out via `prefers-reduced-motion`.
- `openspec-attach-combo`: `SessionOpenSpecActions` renders a 7-node pills+lines stepper (`Explore → Proposal → Design → Specs → Tasks → Apply → Archive`) driven by `ChangeState` + artifact presence + task completion; `Explore` button gated on `!attachedProposal`; `Archive` button gated on `attachedProposal`.
- `chat-view`: the composer (`CommandInput`) mounts a session-action strip (refresh + compact 7-node stepper + OpenSpec + Git + JJ groups) between the existing model/level row and the textarea, sharing the same action gating and slot wiring as the sidebar card.

## Impact

**Code touched**
- `packages/client/src/components/SessionCard.tsx` — `WorkspaceSubcard` splits into `GitSubcard` + `JjSubcard`, MDI icons everywhere.
- `packages/client/src/components/SessionOpenSpecActions.tsx` — add stepper component, rewire `Explore` / `Archive` enable conditions.
- `packages/client/src/components/SessionSubcard.tsx` — no shape change; consumed by new subcards.
- `packages/client/src/components/CommandInput.tsx` — mount new `<ComposerSessionActions>` strip; reuse `<SessionOpenSpecActions>` rendered with strip layout flag.
- `packages/client/src/components/StatePill.tsx`, `openspec-helpers.tsx` — small icon swaps.
- **New** `packages/client/src/components/OpenSpecStepper.tsx` — pure presentational stepper.
- **New** `packages/client/src/components/ComposerSessionActions.tsx` — composer-side action strip host.
- `packages/client/src/index.css` — add `.card-selected-ring` rules (conic gradient via `@property --neon-angle`); per-profile alpha overrides only when contrast requires it.
- `packages/jj-plugin/src/client/JjActionBar.tsx`, `JjWorkspaceBadge.tsx` — keep claims, target moves from `workspace-action-bar` host inside WORKSPACE to inside JJ subcard (no manifest change, but verify predicate firing).

**Tests touched / added**
- `packages/client/src/components/__tests__/SessionCard*.test.tsx` — split-subcard render predicates.
- New `OpenSpecStepper.test.tsx` — state-derivation snapshot tests.
- New `ComposerSessionActions.test.tsx` — mirrors action gating + slot rendering.
- `ThemePicker.test.tsx` — unchanged (verifies the 9 profiles still expose).

**Out of scope**
- Adding new palette profiles (e.g. High-contrast). Mockup explored one but proposal preserves the current set.
- Mobile-only redesign — mobile card path stays as-is; only the desktop card and composer change.
- Server / extension code — pure client redesign.
