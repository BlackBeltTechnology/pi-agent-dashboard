## Context

**Reference mockup:** [`mockup.html`](./mockup.html) — self-contained HTML with profile × mode selector. Open in any browser to inspect every state across all 4 palette profiles and 3 modes. This is the visual contract the implementation MUST match.

The desktop session card today carries three visually-flat sections (OPENSPEC, WORKSPACE, PROCESS/FLOWS/MEMORY) plus a header zone. Two pain points drive this redesign:

1. **`WORKSPACE` mixes two version-control concepts.** The subcard combines git branch / PR / worktree information *and* the jj-plugin's badge (`jj:<workspace>`) and action bar in a single legend-titled block. In jj-colocated repos both apply, but visually they bleed into one another and users can't tell which actions affect which VCS layer. The jj-plugin already declares its claims through the plugin slot registry (`session-card-badge` + `workspace-action-bar`); the host container is the only place mixing happens.

2. **OpenSpec workflow state is illegible.** A single `ChangeState` pill (`PLANNING / READY / IMPLEMENTING / COMPLETE`) tells the user the *current* state but nothing about *progression* — which artifacts already exist, which task batch is being worked, what's next. The `PDST` artifact letters chip helps but reads as a flat status rather than a workflow.

3. **Actions live only in the sidebar.** When focus is in the composer textarea, the user must scroll the sidebar to fire `Explore / Apply / Tasks / Archive / Push / Open PR / Merge / Close`. The chat view has no surface for those actions.

The dashboard already ships a 9-profile `ThemeProvider` (`Base, Dracula, Nord, GitHub, Catppuccin, Tokyo Night, Rosé Pine, Solarized, Gruvbox`) wired via `[data-theme]` and a per-profile light/dark variant — so the redesign can lean on `--accent-*` and `--bg-*` variables without adding new theming machinery.

## Goals / Non-Goals

**Goals**

- Make jj and git visually independent on the session card.
- Make OpenSpec progression instantly readable at a glance (where you are, what's next).
- Make session-level actions reachable from both the sidebar card AND the composer.
- Give the selected session card a recognizable identity without competing with the existing `card-working-pulse / card-input-pulse / card-unread-pulse` activity layers.
- Migrate unicode-glyph-as-icon to MDI for a single icon vocabulary.

**Non-Goals**

- Adding new palette profiles. The 9 existing profiles ship as-is.
- Redesigning the mobile card. Mobile keeps its current single-column layout.
- Changing OpenSpec workflow semantics (`ChangeState` derivation, skill commands, archive flow).
- Changing the plugin slot registry contract or any plugin manifest.
- Server / extension / shared protocol changes — this is a pure client-side redesign.

## Decisions

### 1. Split `WORKSPACE` into `GIT` and `JJ` subcards (host-level, not plugin-level)

**Decision.** The host container for VCS sections inside `SessionCard.tsx` becomes two sibling `<SessionSubcard>` instances: `GIT` and `JJ`. The jj-plugin's `workspace-action-bar` slot binding moves from the (now-deleted) WORKSPACE subcard host to the new JJ subcard host. Predicates: `GIT` renders when `showGitInfo || session.gitWorktree`; `JJ` renders when the existing jj predicates fire (jj-plugin badge claim's `shouldRender` returning true OR `workspace-action-bar` having a claim that renders).

**Alternative considered.** Keep `WORKSPACE` as a single subcard but add an internal divider between git and jj sub-sections. Rejected — the divider keeps the visual coupling; the explicit two-subcard split makes the predicate gating per-VCS and clarifies which group's actions apply to which layer.

**Why now.** The jj-plugin slot registry already separates "badge" and "action bar" claims; only the visual container conflates them.

### 2. Pills+lines stepper inside the `OPENSPEC` subcard

**Decision.** Add a new presentational component `OpenSpecStepper.tsx` that renders 7 nodes — `Explore, Proposal, Design, Specs, Tasks, Apply, Archive` — joined by short progress lines. Node states (`done` / `current` / `todo` / `disabled`) are derived in a pure function from `(attachedProposal, ChangeState, artifacts[], completedTasks, totalTasks)`:

- `Explore` is `done` once any `OpenSpecChange` exists in the cwd OR a proposal is attached; `current` when no proposal is attached and no changes exist; `disabled` when a proposal is attached (gating rule mirrors the button).
- `Proposal / Design / Specs` map directly to the artifact-id presence on the attached change (`artifacts.find(a => a.id === 'proposal').status === 'done'`, etc.).
- `Tasks` is `done` when `completedTasks === totalTasks > 0`, `current` when `0 < completedTasks < totalTasks` AND `ChangeState === IMPLEMENTING`, else `todo`.
- `Apply` is `done` when `ChangeState === COMPLETE` AND all tasks complete, `current` when IMPLEMENTING / READY, else `todo`.
- `Archive` is `done` when `ChangeState` would be archived (out of active list — but this stepper only renders for active changes, so practically `Archive` is `current` when COMPLETE, else `todo`).

The connecting line uses opaque-base node backgrounds (two-stacked-gradients trick) so the progress line never bleeds through the circle interior — a bug we hit in the prototype.

**Alternative considered.** Lifecycle-state stepper (`PLANNING → READY → IMPLEMENTING → COMPLETE → ARCHIVED`). Rejected in user review — artifact pipeline is more concrete and maps 1:1 to the skill commands the user issues.

### 3. Action gating: `Explore` only when no proposal; `Archive` only when proposal attached

**Decision.** `SessionOpenSpecActions` adds two new disabled-state branches:

- `Explore` button: rendered `disabled` (with tooltip "Detach proposal to explore freely") when `attached` is truthy. Today the button always shows. The change moves it from "context-sensitive label" to "context-sensitive enablement" — the button is still visible so the user sees the affordance, but inert until detached.
- `Archive` button: rendered `disabled` (with tooltip "Attach a change to archive") when `attached` is falsy. Today the button only appears for `ChangeState === COMPLETE` on an attached change. The change adds an always-visible disabled state when unattached so the user discovers the action exists.

**Alternative considered.** Hide the buttons entirely when their gate isn't met. Rejected — discoverability matters more than visual minimalism on a power-user card; greyed-out + tooltip teaches the affordance.

### 4. Composer action strip = same components, different layout

**Decision.** Reuse `SessionOpenSpecActions`, `OpenSpecStepper`, and the new `GitActions` + `JjActions` row components inside a new `ComposerSessionActions.tsx` wrapper. The wrapper is mounted in `CommandInput.tsx` between the existing model/level row and the textarea. It takes the same props as the sidebar card's subcards but lays out in a horizontal strip with a smaller stepper variant.

The stepper exposes a `variant: "sidebar" | "compact"` prop. `compact` shrinks node size to 18 px, hides the per-node label below a `hoverable` tooltip, and uses `transform: scale(.92)` for the icon row. No new business logic — same `nodeState()` function.

**Alternative considered.** Put a button row above the composer without the stepper. Rejected — losing the stepper makes the composer strip strictly less informative than the sidebar; users would have to keep glancing back and forth.

**Alternative considered.** Move the actions OUT of the sidebar and ONLY render them above the composer. Rejected in user review — multi-session users need to fire actions from un-focused sessions too, so the sidebar surface stays.

### 5. Selected-card iridescent ring as a separate layer

**Decision.** Add a `.card-selected-ring` rule with two pseudo-elements (`::before` rim + `::after` glow) using a conic gradient driven by a CSS `@property --neon-angle` animated linearly over 13 s. Mounted independently of the existing pulse classes (which use the `background-image` slot) — the ring lives in `inset: -1px` / `inset: -3px` outside the card border, so it never collides with the pulse stripes painted on the card background.

Alpha values per theme are stored in CSS variables (`--neon-rim-alpha`, `--neon-glow-alpha`, `--neon-glow-blur`, `--neon-glow-opacity`) overridden once per `[data-theme="light"]` so palette profiles automatically work without per-profile rules. `prefers-reduced-motion: reduce` disables the animation; the ring stays visible but static.

**Alternative considered.** Animate the existing blue border by hue-rotating. Rejected — hue-rotate on the existing border would interfere with the activity pulse stripes which themselves shift colour; the standalone ring layer keeps concerns separate.

**Alternative considered.** A full rainbow 6-stop gradient. User feedback: too intense. Settled on 4 stops (blue → purple → pink → cyan → blue) at low alpha.

### 6. MDI everywhere — keep `P / D / S / T` as letters

**Decision.** Every unicode-glyph-as-icon on the card and composer migrates to `@mdi/react` + `@mdi/js`. Artifact letters (`P / D / S / T`) stay as letters because they're semantic identifiers, not glyphs — the stepper node renders the letter as the node label content.

Icon mapping locked in the prototype lives in `mockup.html` (this change directory) and is reproduced verbatim in the implementation.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Splitting `WORKSPACE` into `GIT` + `JJ` could cause both subcards to hide in repos where neither predicate fires today, leaving a visible gap above PROCESS. | Add a unit test that exercises the predicate matrix (`pure-git`, `pure-jj`, `colocated`, `neither`); verify no-render for the neither case matches today's `WORKSPACE`-hidden behaviour. |
| Stepper render cost on a long sidebar (many sessions × 7 nodes each). | Stepper is pure presentational, no hooks; node-state derivation is a single pass over `change.artifacts` (≤ 5 items) — cost is negligible. Measure with React Profiler on the 50-session test fixture before / after. |
| Composer action strip duplicating the sidebar surface might confuse users (which one is "active"). | Both surfaces target the same session via `session.id` props and dispatch the same `onSendPrompt` callback — there is no separate "active surface". The strip header reads `session actions · <session-name>` to anchor context. |
| Iridescent ring + existing pulse classes painting at the same time. | Ring is `inset: -1px` outside the card border, pulses paint the card background; different layers. Z-index audit in the prototype confirmed no overlap. |
| Light-mode iridescent ring too subtle on white. | Per-theme alpha override (`[data-theme="light"]` bumps `--neon-rim-alpha` from 0.45 → 0.50, `--neon-glow-blur` 8 → 11 px). Verified across all 9 profiles in the mockup. |
| jj-plugin moving its slot-host container could break its tests. | Plugin manifest unchanged; only the host element under which `workspace-action-bar` mounts changes. Re-run `packages/jj-plugin/src/client/__tests__/*` and inspect the slot-render tests for any container-id assertion. Update if found. |
| `Explore` button stuck disabled traps users who can't figure out how to enable it. | Disabled state carries a tooltip "Detach proposal to explore freely". Same for `Archive` → "Attach a change to archive". |

## Migration Plan

1. **Land the change in dev** with the existing palette / mode controls untouched. No DB / persistence / protocol migration — this is client-side only.
2. **Plugin re-test.** Run `packages/jj-plugin` test suite; fix any host-id assertions in slot tests. Same for `packages/honcho-plugin` (also claims `session-card-memory`) — should be unaffected but verify.
3. **Snapshot the existing `SessionCard` and `CommandInput` storybook stories** (or hand-rolled visual smoke set) before the change; re-snapshot after; diff for unintended visual regressions on unrelated subcards.
4. **Rollback** is a single git revert + `npm run build` + `curl -X POST /api/restart` — no data state to undo.

## Open Questions

- Should the composer action strip also render when no session is selected (e.g. on an empty chat view)? Current proposal: only render when a session is attached to the chat view, mirroring how the existing model/level row behaves.
- Should the iridescent ring intensity be a user-tunable setting (off / subtle / current)? Not in scope for this change; if requested, add `--neon-ring-intensity` config in `ThemeProvider`.
- Does the stepper need a click handler that navigates to the corresponding artifact (e.g. click `Design` to open `design.md`)? The existing `ArtifactLettersButton` covers that path. Decision: stepper is presentational-only; existing button stays.
