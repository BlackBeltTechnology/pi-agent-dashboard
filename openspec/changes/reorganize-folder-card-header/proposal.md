## Why

The sidebar directory card grew by accretion. Its header row now carries three unrelated
jobs on one scan line — identity (`📂 parent/leaf`), signal (`(723)`, `4 need you`), and
mutation (sort · Workspace · open-in-new · pin · × remove) — and four more controls live
one row below. Four concrete defects follow:

1. **Scope error.** The `Workspace` pill acts on `session.cwd` — a property of the
   *directory* — yet renders once per **session card** (`SessionCard.renderAddToWorkspace`).
   A folder with 20 sessions renders 20 identical buttons producing one effect.
2. **Redundant navigation.** The header row click (`folder-home-row-<cwd>`) and the
   `mdiOpenInNew` button (`folder-open-home-<cwd>`) share one destination. The icon renders
   only on pinned/workspace rows — present where the gesture is already learned, absent on
   plain folders where it might teach.
3. **Three notification surfaces.** `(723)`, `FolderNeedsYouPill`, and `FolderStatusRollup`
   answer overlapping questions, and the rollup is **collapsed-only** — folder liveness
   disappears exactly when you expand the folder to inspect it.
4. **No colour scarcity.** Mutations and the attention pill share tier 1 at equal visual
   weight, diluting the pre-attentive purple signal that attention-routing depends on.
5. **The slot pills carry nine more action buttons** — more than the header itself — because
   `directory-card-layout` mandates that "each slot section SHALL keep its own data hook and
   secondary actions (refresh, create)". Among them `mdiRefresh` appears **four times** on one
   card with four different scopes and `mdiPlus` twice: six glyph collisions that are
   invisible until you count across the whole card.

A fifth defect is latent in the code: `WorktreeInitChip` already `flex-wrap`s onto its own
full-width line to avoid overlapping the git row (`SessionList.tsx` ~1195). It was already
a banner — it simply had no name, so it shipped as a wrapping exception.

## What Changes

Reorganize the folder card into **four tiers, one job per tier**:

```
TIER 1  identity + urgency     📂 …/pi-agent-dashboard   [💬4 │ ●2 │ 717]   ⋯
TIER 2  git facts, no controls ⑂ develop   ● 2 uncommitted
TIER 0  call-to-action banner  ⚠ Initialize failed — pnpm install exit 1   [Retry]
TIER 3  directory state pills  AUTOMATIONS │ GOALS │ KB │ OPENSPEC
```

Four invariants govern placement:

1. **Pills read a number; the menu changes something.** No exceptions — which is why
   `Workspace` does NOT join the tier-3 pill grid despite being directory-scoped.
2. **Tier 2 is facts only.**
3. **Tier 0 means the folder cannot proceed.** A call to action is never a small button in a
   row — it is a banner with a sentence. But optional freshness is a *menu* affordance,
   never a banner.
4. **No glyph may mean two things** on the same card.

Concretely:

- **New `⋯` folder-actions menu** replaces the trailing icon cluster, grouped
  `WORKSPACE` (Add to workspace… · Remove from workspace) and `DIRECTORY`
  (Pin directory · Float blocked to top · Directory settings…).
- **Delete `mdiOpenInNew`.** The header row already navigates; the leaf name underlines on
  hover to teach the gesture.
- **Delete the session-card `Workspace` pill.** `SessionCard.renderAddToWorkspace` and its
  `session:<id>` popover scope are removed.
- **One status capsule** replaces `(723)` + `FolderNeedsYouPill` + `FolderStatusRollup`.
  Severity-ordered **needs-you > error > working > idle**; only the leading tier is tinted;
  segments are individually clickable; renders in BOTH collapsed and expanded states.
- **New tier-0 banner** absorbs every structural call to action — `ProjectInitButton`,
  `WorktreeInitButton`, `WorktreeInitChip` (running/failed) and `Clean up broken (N)` —
  using the existing `--severity-{info,warning,error}-{bg,fg,border}` triples, which
  `index.css` already designates the single colour source of truth for banner surfaces.
  **No new design tokens.**
- **Move the settings gear** into `⋯ → DIRECTORY` so tier 2 holds zero controls.
- **Strip all nine slot-pill action buttons.** A pill becomes one click target and nothing
  else. Their actions move into the menu under host-owned verb groups
  (`WORKSPACE · DIRECTORY · CREATE · OPEN · MAINTENANCE`); the four per-slot refreshes collapse
  into one `Refresh folder data`, while KB reindex stays distinct because it is not a refetch.
- **`SlotPill.actions?: ReactNode` is removed.** Plugins contribute declarative items
  (`{ id, group, label, icon, badge, disabled, onSelect }`) to a `folder-actions-menu` slot
  instead of injecting markup. **Breaking for plugin authors, deliberately** — the host must
  own grouping, ordering, keyboard semantics and the mobile sheet, which is impossible with
  opaque nodes.
- **Project setup becomes idempotent and permanent.** `WorktreeInitStatus.configured?: boolean`
  becomes a per-artifact tally, so a directory holding `openspec/` but no `AGENTS.md` is
  representable. Banner when something is missing (`Setup incomplete · 3/5` + the missing
  list); no banner when complete; a `Project setup… N/M` item is present in `⋯ → DIRECTORY`
  in every case, so the action is never hidden.
- **Re-trust prompt gets a banner; template drift does not.** `hookDefHash` changing revokes
  TOFU trust and blocks the hook, so it earns a warning banner. A merely-outdated template
  set is optional and would fire on every folder at once after a pi upgrade, so it renders
  as `Project setup… ● update` in the menu (invariant 3).
- **Two icon collisions fixed.** Project setup moves off `mdiFolderPlusOutline` (reads as
  "add a folder" beside the card's own `mdiFolderOpen`) to **`mdiTextBoxCheckOutline`**; the
  init hook moves off `mdiCogPlayOutline` (collided with `mdiCog` = Directory settings) to
  **`mdiScriptTextPlayOutline`**. `mdiViewGridPlus` is reserved for add-to-workspace only.

Result: tier 1 goes from 4 permanent buttons + 2 coloured elements to **1 and 1**.

Mockup + rationale: `mockups/index.html`, `mockups/ui-plan.md`. Decision record: `design.md`.

### Explicitly out of scope

**Template-drift detection.** Deciding *whether* a configured directory is behind the
recommended templates needs a hashed template set, a persisted per-directory stamp and a new
`init-status` field. This change ships only the UI slot: `● update` renders iff
`initStatus.setupOutdated === true`, a field nothing emits yet. A follow-up change
implements the detection.

The per-artifact setup tally **is** in scope — it is a `stat` of a known file list, not new
hashing infrastructure.

## Capabilities

### New Capabilities

- `folder-card-action-banner`: a full-width, severity-tinted call-to-action row rendered
  only when a directory needs a structural action.
- `folder-actions-menu-contributions`: declarative menu-item contribution API with a fixed
  host-owned group taxonomy, replacing caller-supplied pill action markup.

### Modified Capabilities

- `sidebar-folder-header`: trailing cluster collapses to a single overflow-menu button;
  the card gains an explicit tier model.
- `session-attention-routing`: the needs-you rollup becomes one segment of a unified,
  severity-ordered status capsule that renders in both collapse states.
- `add-to-workspace-affordance`: the labelled pill becomes a grouped menu item on the
  folder card only; the session-card instance is removed.
- `folder-action-bar`: init, setup and cleanup controls leave the git row for tier 0;
  settings moves to the menu; project setup becomes idempotent and gains a per-artifact
  tally; the bar retains no controls and is removed.

- `directory-card-layout`: slot pills lose their secondary action buttons and become pure
  click targets; `SlotPill` loses its caller-supplied actions prop.

### Removed Capabilities

- `directory-home-page` → `Requirement: Sidebar open affordance`: superseded by
  `Requirement: Whole-row open affordance`, which already covers sidebar navigation to
  `/folder/:encodedCwd` without a dedicated icon.

## Discipline Skills

`scenario-design` (derive the test plan for capsule/banner state matrices and the E2E
migration), `review-code` (multi-component client change before commit),
`code-simplification` (`FolderActionBar` should end up deleted, not merely emptied).

## Impact

- **Plugins**: `packages/dashboard-plugin-runtime/src/SlotPill.tsx` (drop `actions`),
  `packages/kb-plugin/src/client/FolderKbSection.tsx`,
  `packages/goal-plugin/src/client/FolderGoalsSection.tsx`,
  `packages/automation-plugin/src/client/FolderAutomationSection.tsx`,
  `packages/client/src/components/openspec/FolderOpenSpecSection.tsx` — each stops rendering
  buttons and contributes menu items instead.
- **Code**: `packages/client/src/components/session/SessionList.tsx` (cluster → menu,
  `renderAddToWorkspaceButton`, tier assembly), `SessionCard.tsx` (drop
  `renderAddToWorkspace`), `folder/FolderNeedsYouPill.tsx` → status capsule,
  `folder/FolderStatusRollup` (absorbed), `folder/FolderActionBar.tsx` (emptied → deleted),
  `packages/client/src/components/packages/ProjectInitButton.tsx` +
  `worktree/WorktreeInitButton.tsx` (re-shaped as banners).
- **Server**: `GET /api/git/worktree/init-status` replaces `configured?: boolean` with a
  per-artifact tally (`packages/server/src/routes/git-routes.ts`,
  `packages/server/src/git-worktree/worktree-init.ts`) and reports whether the trusted hook
  hash still matches (`worktree-init-trust.ts` already computes both sides). Reserves a
  `setupOutdated?: boolean` field that stays unset until the follow-up change.
- **Tokens**: none added. Banner reuses `--severity-*`; capsule reuses `--status-*`.
- **Icons**: two reassignments (`mdiTextBoxCheckOutline`, `mdiScriptTextPlayOutline`), both
  verified unused against the 225 distinct MDI glyphs in tracked sources.
- **Test ids** (full table in `mockups/ui-plan.md`): `folder-open-home-<cwd>` and
  `session-card-add-to-workspace-<id>` are **deleted**; `add-to-workspace-btn-<cwd>`,
  `folder-urgency-sort-<cwd>`, `pin-dir-btn`/`unpin-dir-btn`,
  `ws-remove-<wsId>-<cwd>`, `folder-cleanup-broken-btn` move behind `⋯` or into tier 0;
  new: `folder-actions-menu-<cwd>`, `folder-status-capsule-<cwd>`,
  `folder-capsule-seg-<kind>-<cwd>`, `folder-banner-<kind>-<cwd>`.
  The nine slot-pill test ids (`folder-automation-new-btn`, `folder-automation-refresh`,
  `folder-goal-new-btn`, `folder-goals-refresh`, `folder-kb-reindex`, `folder-kb-index-now`,
  `folder-kb-retry`, `folder-openspec-refresh`, `folder-archive-btn`, `folder-specs-btn`)
  move behind the menu; `*-refresh` ids collapse into one.
- **Tests**: `tests/e2e/folder-membership-drag.spec.ts:151,171,194` clicks
  `add-to-workspace-btn-<cwd>` directly and needs a menu-open step.
  `packages/client/src/components/__tests__/SessionList.test.tsx` add-to-workspace block
  needs the same.
- **A11y**: `⋯` carries `aria-haspopup="menu"` + `aria-expanded`; items carry
  `role="menuitem"`; capsule segments are `<button>`s with distinct labels; header row
  keeps `min-h-[44px] md:min-h-0` (WCAG 2.5.5); the banner spinner honours
  `prefers-reduced-motion`.
- **Risk**: medium-high. Broad across the sidebar, moves fourteen previously one-click
  actions behind a menu, and breaks the plugin pill-action contract. Menu length (13 items /
  5 groups) is the main UX risk and makes a proper mobile sheet mandatory.
- **Supersedes**: `compact-session-card-workspace-pill` (withdrawn — it resized a control
  this change deletes).
