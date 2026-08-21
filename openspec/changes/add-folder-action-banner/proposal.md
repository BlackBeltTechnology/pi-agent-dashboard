## Why

> **Apply blocker (`fix-reliable-live-control-events`):** `resolveConfigRoot(cwd)` now resolves a linked worktree to its own top level. Main-checkout inheritance assumptions below are stale. Reconcile checklist base and scenario E3 before implementation.

Change 3 of the four-way directory-card split established in
`openspec/changes/archive/2026-08-09-add-folder-actions-menu/design.md`
(decisions **D4, D5, D6, D7**). Change 1 explicitly left `FolderActionBar` in place; this
change is what empties it.

Three defects, all visible on an unconfigured directory today:

1. **Calls to action are squatting in the git row.** `ProjectInitButton` ("Set up project"),
   `WorktreeInitButton`, `WorktreeInitChip` and `Clean up broken (N)` render beside the
   branch name. The code already conceded the shape it wants — `SessionList.tsx` comments
   that a wide init state "SHALL wrap to its own line rather than overflow the git row". It
   is already a banner without a name, implemented as a wrapping exception. It also violates
   the tier model's invariant 2 (*tier 2 is facts only*).
2. **Project setup is modelled as a birth event, not an idempotent action.**
   `WorktreeInitStatus.configured?: boolean` cannot express "has `openspec/` but no
   `AGENTS.md`". Today's `folder-action-bar` spec codifies the dead end:
   `{ hasHook: false, configured: true }` → "the row SHALL render NO initialize control of
   either kind — there is nothing to initialize" — which is exactly the state the user needs
   to act on. A partially-set-up project is unreachable from the UI.
3. **Two glyph collisions.** `mdiFolderPlusOutline` (project setup) reads as "add a folder"
   beside the card's own `mdiFolderOpen`; `mdiCogPlayOutline` (run init hook) collides with
   `mdiCog`. Both violate invariant 4 (*no glyph may mean two things on the same card*).

## What Changes

- **Tier-0 call-to-action banner.** `ProjectInitButton`, `WorktreeInitButton` and
  `WorktreeInitChip` leave the git row for a full-width banner rendered **below tier 2**
  (below the git row when present, directly under the header row when there is none).
  `ProjectInitButton` is deleted; `WorktreeInitButton` is **re-hosted inside the banner**,
  since it owns the trust-confirm dialog and the run call.
- **Tier 0 means the folder cannot proceed** (invariant 3). Optional freshness is never a
  banner.
- **`Clean up broken (N)` does NOT join the banner** — a deviation from archived D4. Broken
  sessions are housekeeping and do not block the folder, so by invariant 3 the action belongs
  in the folder actions menu's existing `DIRECTORY` group, not tier 0.
- **`FolderActionBar` is emptied and deleted.** Change 1 already moved its settings cog; with
  the init and cleanup controls gone it has no contents.
- **`configured?: boolean` becomes a per-artifact checklist** on the init-status payload,
  stat'ed against the **config root** (for a worktree that is the main checkout, not the row's
  own directory) and computed for every response, including hook-declaring repos:

  | `.pi/settings.json` | Tier 0 | `⋯ → DIRECTORY` |
  |---|---|---|
  | absent | info — **Not a pi project yet** `[Set up →]` | `Project setup… 0/N` |
  | present | *no banner*, whatever the optional tally | `Project setup… n/N` |

- **Exactly one artifact is required: `.pi/settings.json`** — a deviation from archived D5,
  which also specified a partial "Setup incomplete · 3/5" banner. That rung cannot survive
  invariant 3: a repo with a working pi config, a trusted hook and running sessions but no
  `AGENTS.md` is demonstrably proceeding, yet would carry a permanent tier-0 banner. Partial
  setup is reported by the menu tally only.

- **The `Project setup…` menu item is permanent** with one stable label so muscle memory
  holds. The banner carries urgency; the menu carries availability.
- **Banner gated on *required* artifacts only.** Optional artifacts are menu-only, so a
  merely-incomplete setup does not claim "cannot proceed".
- **Probe failure fails open** — a failed artifact probe renders **no** banner, never a false
  "not a pi project".
- **Hook-definition change is a banner; template drift is not.** The existing `hookDefHash`
  TOFU (`worktree-init-trust.ts`) answers a *security* question — trust revoked, repo bash may
  not run from a UI click until re-confirmed — and gets a `--severity-warning-*` banner with
  `[Review…]`. "Templates moved on" is optional and non-blocking, would fire on every folder
  at once after a pi upgrade, and is demoted to `⋯ → Project setup… ● update`.
- **Icon fixes (D8).** Project setup → `mdiTextBoxCheckOutline`; run init hook →
  `mdiScriptTextPlayOutline`; init failed → `mdiAlertCircleOutline`; cleanup keeps `mdiBroom`.
- **No new tokens.** Banner surfaces use the existing
  `--severity-{info,warning,error}-{bg,fg,border}` triples that `index.css` designates the
  single colour source of truth.

### Out of scope (D7 scope split)

- **Template-drift detection.** Hashing the template set, persisting a per-directory stamp and
  exposing it on `init-status` is deferred to a follow-up. This change ships only the UI slot:
  the client renders `● update` iff `initStatus.setupOutdated === true`, a field nothing emits
  yet.
- The status capsule (D2) → `unify-folder-status-capsule`.
- Slot-pill actions and the `SlotPill.actions` prop (D9/D10) → `move-slot-actions-to-menu`.

The per-artifact checklist (D5) **is** in scope despite needing server work — it is a `stat`
of a known file list, not new hashing infrastructure.

## Capabilities

### New Capabilities

- `folder-action-banner`: a full-width tier-0 surface, rendered only when the folder cannot
  proceed, that hosts project setup, init-hook run, init progress/failure and broken-session
  cleanup, coloured from the existing severity tokens.

### Modified Capabilities

- `folder-action-bar`: its two Initialize requirements are removed — the controls move to the
  banner and the `FolderActionBar` **component** is deleted. The **capability is not
  retired**: it also owns the `+Session` / `+Worktree` / elevated-spawn requirements, which
  physically live in that spec file and have no other home. Includes retiring the
  `{ hasHook: false, configured: true }` → "nothing to initialize" requirement, which the
  per-artifact checklist falsifies.
- `worktree-init-hook`: `WorktreeInitStatus.configured?: boolean` becomes a per-artifact
  present/missing checklist; a new `setupOutdated?: boolean` field is declared (emitted by a
  later change).
- `worktree-init-feedback`: init progress and failure states render in the banner, not inline
  on the git row.
- `folder-actions-menu`: gains the permanent `Project setup…` item with its `n/N` tally and
  optional `● update` badge.
- `directory-card-layout`: the tier model and the four card invariants are **promoted from
  change prose into the spec** — they were cited as binding by earlier changes but never had a
  normative home — and tier 0 plus its placement rule are added.
- `sidebar-folder-header`: the git row becomes facts-only; the requirement gating
  `FolderActionBar`'s presence on the git row is rewritten for a card where the bar no longer
  exists.
- `directory-settings-page`: its two references to the deleted `FolderActionBar` are restated
  against the card rather than the component.

## Discipline Skills

`scenario-design` (the 0-of-N / partial / all matrix, probe-failure fail-open, banner
placement with and without a git row), `doubt-driven-review` (the `configured` boolean → object
shape is a wire-format change with a plugin-visible payload), `review-code` (client + server
change before commit).

## Impact

- **Code**: `packages/client/src/components/folder/FolderActionBar.tsx` (**deleted**),
  `packages/client/src/components/packages/ProjectInitButton.tsx` (**deleted**),
  `packages/client/src/components/worktree/WorktreeInitButton.tsx` + `WorktreeInitChip`
  (**re-hosted** in the banner), `packages/client/src/hooks/useInitStatus.ts` (its owner moves
  out of the deleted bar), `packages/client/src/components/session/SessionList.tsx` (banner
  placement; cleanup moves to the menu), server-side init-status probe.
- **Tokens**: none added.
- **Test ids**: `folder-cleanup-broken-btn` is superseded by the menu item
  `folder-menu-cleanup-broken-<cwd>`; new `folder-banner-{setup,init-needed,retrust,failed,running}-<cwd>`.
  `project-init-btn` is superseded by the banner's action.
- **Tests**: `ProjectInitButton.test.tsx`, `FolderActionBar.test.tsx` **and
  `FolderActionBar-cleanup-broken.test.tsx`** (both retire with the component),
  `packages/client/src/__tests__/state-feedback-adoption.test.tsx` (hardcodes the
  `folder/FolderActionBar.tsx` path), `WorktreeInitButton` tests, plus any E2E that clicks
  `folder-cleanup-broken-btn`.
- **Wire compatibility**: `configured?: boolean` → checklist is a **breaking payload change**
  on init-status. Client and server ship together; a stale client must degrade to no banner,
  not to a false one.
- **A11y**: the banner is a landmark-adjacent region with an accessible name; its action is a
  real `<button>`; error banners announce politely, not assertively.
- **Known risk carried from design**: tier-0 vertical cost. A banner is ~34px per folder;
  many unconfigured pinned folders could fill the sidebar. Mitigated by D6's demotion of
  template drift (the one state that would fire on every card at once) and gating on required
  artifacts. If it still bites, cap at one banner + "+N more".
- **Risk**: medium-high. Touches the wire format, deletes a component, and changes the first
  thing a new user sees on an unconfigured directory.
