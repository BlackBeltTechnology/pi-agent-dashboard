# Design — folder card header reorganization

Mockup: `mockups/index.html`. Token/state reference: `mockups/ui-plan.md`.

> ## SCOPE WARNING — read before implementing
>
> This is the **shared design record for all four sequenced changes**, carried over from the
> `reorganize-folder-card-header` umbrella that doubt-review forced apart. It describes the
> **end state**, not the scope of the change it currently sits in.
>
> **`add-folder-actions-menu` (this change) implements D1 and D3 only**, plus the menu itself.
> D8 supplies the trigger glyph; D11 and D12 are correction records, not deliverables — D12 is
> what justifies retiring the `folder-action-bar` Pi Resources requirement.
>
> | Decision | Lands in |
> |---|---|
> | D1 Workspace leaves the session card, D3 open-in-new deleted, menu + cluster collapse | **1 · add-folder-actions-menu** (this) |
> | D2 status capsule | 2 · unify-folder-status-capsule |
> | D4 tier-0 banner, D5 idempotent setup, D6 staleness surfaces, D7 scope split | 3 · add-folder-action-banner |
> | D9 slot-pill actions, D10 plugin contract | 4 · move-slot-actions-to-menu |
>
> Anything in this file describing a status capsule, a banner, a per-artifact setup tally, a
> five-group menu, or the removal of `SlotPill.actions` is **out of scope here**. In particular
> the tier diagram below shows the end state: this change delivers only the menu trigger on
> tier 1 and leaves `FolderActionBar` in place.
>
> The `⋯` shorthand used throughout this document predates D8. The trigger glyph is
> **`mdiFolderCogOutline`**; `mdiDotsHorizontal` was rejected. Read `⋯` as "the folder actions
> menu", not as the glyph.

## The tier model

```
TIER 1  identity + urgency     📂 …/pi-agent-dashboard   [💬4 │ ●2 │ 717]   ⋯
TIER 2  git facts, no controls ⑂ develop   ● 2 uncommitted
TIER 0  call-to-action banner  ⚠ Initialize failed — pnpm install exit 1   [Retry]
TIER 3  directory state pills  AUTOMATIONS │ GOALS │ KB │ OPENSPEC
```

Tier 0 renders **below** tier 2 so identity stays at the top of the card, but is numbered 0
because when present it outranks everything else in importance.

## Governing invariants

1. **Pills read a number; the menu changes something.** No exceptions.
2. **Tier 2 is facts only** — no controls beyond the branch/dirty affordances themselves.
3. **Tier 0 means the folder cannot proceed.** Optional freshness is a menu affordance,
   never a banner.
4. **No glyph may mean two things** on the same card.

## D1 — Workspace is directory-scoped, so it leaves the session card

`SessionCard.renderAddToWorkspace` targets `session.cwd`. Rendering it per session produced
N identical buttons with one effect. It moves to `⋯ → WORKSPACE` on the folder that owns
the cwd.

**Rejected:** making it a tier-3 pill next to AUTOMATIONS/GOALS/KB. It is directory-scoped
like they are, but it *mutates*, and invariant 1 has no exceptions.

**Rejected:** resizing it to match `Fork`/`+Session` (the withdrawn
`compact-session-card-workspace-pill`). That treated a scope error as a sizing error.

## D2 — One status capsule replaces three counters

`(723)` + `FolderNeedsYouPill` + `FolderStatusRollup` become one severity-ordered capsule.
Segments are individual buttons; the trailing idle count is inert.

**Severity order: needs-you > error > working > idle.** A human actively waiting outranks a
crash — the crash is already over, the wait is not.

The capsule renders in **both** collapse states. Today `FolderStatusRollup` is
collapsed-only, so folder liveness vanished exactly when the user expanded the folder to
inspect it.

## D3 — Open-in-new is deleted, not moved

`folder-home-row-<cwd>` already navigates to `/folder/:encodedCwd`. `mdiOpenInNew` was a
second affordance for the same destination, and it rendered only on pinned/workspace rows —
present where the gesture is already learned, absent where it would teach. The leaf name
underlines on hover instead.

## D4 — Every call to action becomes a tier-0 banner

`ProjectInitButton`, `WorktreeInitButton`, `WorktreeInitChip` and `Clean up broken (N)` all
leave the git row. The existing code already conceded the shape: `SessionList.tsx` comments
that a wide init state "SHALL wrap to its own line rather than overflow the git row". It was
already a banner without a name, implemented as a wrapping exception.

Colours come from the existing `--severity-{info,warning,error}-{bg,fg,border}` triples,
which `index.css` designates the single colour source of truth for banner surfaces.
**No new tokens.**

## D5 — Project setup is idempotent, not a birth event

The action must be re-runnable on an already-configured directory: a repo may have
`openspec/` but no `AGENTS.md`, or an `AGENTS.md` predating the recommended layout.

`WorktreeInitStatus.configured?: boolean` cannot express that. Today's spec even codifies
the dead end — `{ hasHook: false, configured: true }` → "the row SHALL render NO initialize
control of either kind — there is nothing to initialize" — which is exactly the state the
user needs to act on.

`configured` becomes a per-artifact checklist. Three states:

| Present | Tier 0 | `⋯ → DIRECTORY` |
|---|---|---|
| 0 of N | info — **Not a pi project yet** `[Set up →]` | `Project setup… 0/N` |
| partial | info — **Setup incomplete · 3/5** + missing list `[Complete →]` | `Project setup… 3/5` |
| all | *no banner* | `Project setup… 5/5` |

The menu item is **permanent** with one stable label, so muscle memory holds. The banner
carries urgency; the menu carries availability.

## D6 — The existing sha256 answers a security question, not a freshness one

`hookDefHash` = sha256 over canonical `worktreeInit`; the TOFU key is `repoRoot + hash`
(`worktree-init-trust.ts`). When it changes, trust is **revoked** and repo-provided bash may
not run from a UI click until re-confirmed. That is not "an update is available".

| Question | Mechanism | Status |
|---|---|---|
| Does the hook need running? | project's own `gate` bash, `needsInit: exit === 0` | exists |
| Is the hook still trusted? | `hookDefHash` TOFU | exists — **security** |
| Are setup files current with the templates? | none | **gap** |

Two surfaces, deliberately different:

- **Hook definition changed** → tier-0 banner, `--severity-warning-*`, `[Review…]`. Blocking
  (the hook cannot run) and carries a security decision.
- **Templates moved on** → `⋯ → Project setup… ● update`. **Never a banner** (invariant 3):
  it is optional, non-blocking, and would fire on *every* folder at once after a pi upgrade.

That demotion also resolves the tier-0 vertical-cost risk: the one state that would have
flooded every card simultaneously is the one kept out of tier 0.

## D7 — Scope split

Template-drift **detection** (hash the template set, persist a per-directory stamp, expose
it on `init-status`) is deferred to a follow-up change. This change ships only the UI slot:
the client renders `● update` iff `initStatus.setupOutdated === true`, a field nothing emits
yet.

The per-artifact setup checklist (D5) **is** in scope despite needing server work — it is a
`stat` of a known file list, not new hashing infrastructure.

## D9 — Tier 3 was never state-only (correction)

"Tier 3 is state-only" was asserted without checking and is false. The slot pills carry **10
action buttons**, and `directory-card-layout` mandates them: *"each slot section SHALL keep
its own data hook and secondary actions (refresh, create)"*. Invariant 1 was being enforced
on `Workspace` alone while nine violations sat two rows below it — and that false premise was
the stated reason `Workspace` could not be a pill.

| Pill | Buttons | Glyph | Resolution |
|---|---|---|---|
| AUTOMATIONS | `folder-automation-new-btn` | `mdiPlus` | ⋯ → CREATE |
| | `folder-automation-refresh` | `mdiRefresh` | folded |
| GOALS | `folder-goal-new-btn` | `mdiPlus` | ⋯ → CREATE |
| | `folder-goals-refresh` | `mdiRefresh` | folded |
| KB | `folder-kb-reindex` / `-index-now` / `-retry` | `mdiRefresh` | ⋯ → MAINTENANCE, keeps its stale badge |
| OPENSPEC | `folder-openspec-refresh` | `mdiRefresh` | folded |
| | `folder-archive-btn` | `mdiArchiveOutline` | ⋯ → OPEN |
| | `folder-specs-btn` | `mdiFileDocumentOutline` | ⋯ → OPEN |

The glyph audit is worse than tier 1's: `mdiRefresh` renders **six times** on one card with six
different scopes (KB alone accounts for four), `mdiPlus` twice. Invariant 4 violated eight times
— invisible precisely because each pill is locally reasonable. Only counting across the card
exposes it.

**The three plain refreshes collapse to one.** Nobody wants to refresh *only* goals; per-slot
refetch is data plumbing leaking into the UI. KB's three controls fold into one reindex item
that stays distinct, because rebuilding an index is not refetching a view.

**`Archive` / `Specs` move rather than die.** They are navigation, and the case for deleting
them (the board they duplicate is one pill-click away, as with `mdiOpenInNew`) was rejected —
they are used often enough to keep a shortcut, just not a permanent button.

Net: **10 pill buttons → 0**; the menu holds 13 items across 5 groups (including Pi Resources).

**`Pi Resources` was nearly destroyed.** `FolderActionBar` hosts `onOpenPiResources`, and the
first draft deleted the container without rehoming it — the spec requirement for it would have
dangled and the feature would have silently vanished. It moves to the `OPEN` group.

## D10 — Menu taxonomy is host-owned; plugins contribute data

`SlotPill` exposes `actions?: ReactNode`, so `kb-plugin`, `goal-plugin` and
`automation-plugin` inject arbitrary markup into the card. Moving those actions into the menu
makes that prop untenable: the host cannot group, order, keyboard-navigate or mobile-adapt
opaque nodes.

The prop is removed. Plugins contribute declarative items
(`{ id, group, label, icon, badge, disabled, onSelect }`) to a `folder-actions-menu` slot.

**Groups are a fixed host-owned verb taxonomy** — `WORKSPACE · DIRECTORY · CREATE · OPEN ·
MAINTENANCE` — not one group per plugin. Grouping per plugin would produce single-item groups
(`KB` → one item) and leak the extension architecture into the user's mental model. Groups
render only when non-empty, and order is stable regardless of plugin registration order.

Because a verb group no longer says which slot an item came from, ambiguous labels are
slot-qualified ("OpenSpec archive", not "Archive").

**This is breaking for plugin authors, deliberately.** The trade: plugins lose the ability to
render markup into the directory card; the host gains a single place to enforce grouping,
a11y and the mobile sheet.

## D8 — Icon assignments

No glyph may mean two things on the same card. Verified against the **225** distinct MDI glyphs
in tracked sources.

**The audit method was itself defective.** Repo-wide distinctness cannot detect *per-card*
duplication — the exact failure it is meant to catch. It passed `mdiDotsHorizontal` as "new"
while `WorktreeActionsMenu` already used it on a card that renders inside the folder body. D9
had already established that only counting across the rendered card exposes collisions; that
lesson was not applied to the glyph introduced by this change. Any future glyph decision must
enumerate what the *rendered card* shows, not what the repo contains.

`mdiViewGridPlus` is reserved for add-to-workspace **on the directory card**; the dashboard's
*New Workspace* button (`DashboardSpawnButtons.tsx`) also uses it, off-card.

| Action | Glyph | Note |
|---|---|---|
| Add to workspace | `mdiViewGridPlus` | unchanged; **reserved** — this meaning only |
| Remove from workspace | `mdiClose` | unchanged |
| Pin directory | `mdiPin` | unchanged |
| Float blocked to top | `mdiSortVariant` | unchanged |
| Directory settings | `mdiCog` | unchanged |
| Folder actions menu | `mdiFolderCogOutline` | `mdiDotsHorizontal` was **rejected** — `WorktreeActionsMenu` already renders it on worktree session cards *inside the folder body*, so two identical triggers with different scopes would share a card |
| Pi Resources | existing glyph, relocated | moves to the menu's OPEN group |
| **Project setup** | **`mdiTextBoxCheckOutline`** | replaces `mdiFolderPlusOutline`, which read as "add a folder" beside the card's own `mdiFolderOpen` |
| **Run init hook** | **`mdiScriptTextPlayOutline`** | replaces `mdiCogPlayOutline`, which collided with `mdiCog` |
| Init failed | `mdiAlertCircleOutline` | |
| Clean up broken | `mdiBroom` | unchanged |

**Rejected for project setup:** `mdiSproutOutline` (means "something begins here" — wrong
for an idempotent top-up), `mdiFileTreeOutline` / `mdiPuzzleOutline` / `mdiCompassOutline` /
`mdiFormatListChecks` / `mdiClipboardCheckOutline` (all already in use),
`mdiRocketLaunchOutline` ("launch" wanted later for run/deploy), `mdiAutoFix` (may be wanted
for generic AI-generate), `mdiCheckDecagramOutline` (reads as a passive badge).

## D11 — Corrections from doubt-review cycle 1

A fresh-context reviewer plus a cross-model reviewer (`@propose-review-1`, `zai/glm-5.2`)
found the artifact under-scoped its delta set and mis-stated several counts. Reconciled:

| Finding | Class | Resolution |
|---|---|---|
| `directory-home-page` whole-row requirement says the icon affordance "SHALL remain" | actionable | that requirement is now MODIFIED, not left dangling |
| `sidebar-folder-header` layout + chevron requirements name `FolderActionBar` and the pin button | actionable | both MODIFIED |
| `folder-action-bar` Pi Resources requirement orphaned | actionable | REMOVED in change 1 — see D12; it was already superseded, not rehomed |
| `openspec-folder-section` mandates a Refresh control and a folder-level Refresh button | actionable | **deferred to change 4** — the delta drafted for the umbrella was withdrawn in the split |
| `kb-plugin-folder-section` mandates a per-state reindex control | actionable | **deferred to change 4** — same |
| `group-commit-btn` is a standalone mutation on the git row | actionable | **deferred to change 3**, which owns the git-facts row |
| Menu re-enabled pin / add-to-workspace inside workspaces | actionable | placement gating now explicit in the spec |
| Tier-0 "cannot proceed" vs a banner for merely-incomplete setup | actionable | banner now gated on **required** artifacts; optional ones are menu-only |
| Probe failure could render a false "not a pi project" banner | actionable | fail-open now renders no banner |
| `--status-*` are single values, not triples | actionable | leading tint is derived by `color-mix`, mirroring the severity triples |
| Capsule error segment had no data source (`countStatusRollup` is working/idle only) | actionable | sourced from the session-card error signal; rollup extended |
| `SlotPill` `placement` prop mechanism dropped when the requirement was rewritten | actionable | restored |
| Mobile sheet asserted mandatory but in no spec | actionable | now a requirement |
| Banner placement undefined without a git row | actionable | position defined for both cases |
| Init-hook feedback detail (elapsed, log disclosure, no auto-dismiss) lost in relocation | actionable | preserved by requirement |
| Counts: 9 vs 10 buttons, refresh ×4 vs ×6, 13 vs 12 items, "four defects" then five, 225 vs 226 glyphs | actionable | corrected |
| `configured` cited in `worktree-init.ts` | actionable | it lives in `routes/git-routes.ts` |
| `goals-folder-page` mandates Refresh / + New Goal | **noise** | that is the goals *content page* header, not the slot pill |

**Residual, accepted:** the menu trigger `mdiFolderCogOutline` contains a cog, and the menu's
`Directory settings…` item uses `mdiCog`. Both are visible while the menu is open. This is a
weaker echo than two identical `⋯` triggers (trigger vs. item, different levels) but it is not
zero — flagged rather than hidden.

## D12 — Pi Resources was already gone; the cog is Directory Settings

A second doubt cycle (on the split artifact) flagged that removing the `FolderActionBar` cog
"orphans Pi Resources". Checking source: the button's `title` and `aria-label` are both
**"Directory Settings"**, and `directory-settings-page` records that this cog replaced "the
prior `mdiToyBrickOutline` icon and 'Pi Resources' label". Only the handler prop still carries
the legacy name `onOpenPiResources`.

So there is no Pi Resources button to rehome — D9's earlier claim that the feature "was nearly
destroyed" was itself based on the stale prop name, not on the rendered control. The
`folder-action-bar` requirement is REMOVED as already-superseded, and the prop is renamed.

`pi-resources-view`'s "Folder header navigation button" requirement is stale in exactly the
same way. It is **not** fixed here — that drift predates this change and fixing it would widen
the delta set for no behavioural gain. Recorded in the proposal instead.

**Lesson:** a prop name is not evidence of a rendered control. D9 asserted a feature existed
because a callback was named after it.

## Open

0. **Menu length.** 13 items across 5 groups is a long menu; Hick's Law now cuts the other
   way. Grouping mitigates but does not eliminate it. A mobile sheet is mandatory, not
   optional.
1. **Banner placement drifts.** Tier 0 sits under tier 2, but an unconfigured directory has
   no git row, so its banner lands directly under tier 1 — one element, two visual
   positions.
2. **Pin discoverability.** Pinning is how an unpinned folder becomes sticky, and it is now
   one click deeper.
3. **`Commit` merged into the `2 uncommitted` chip** makes an informational chip clickable,
   mildly inconsistent with the inert idle capsule segment.
