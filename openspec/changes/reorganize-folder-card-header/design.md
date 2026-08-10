# Design — folder card header reorganization

Mockup: `mockups/index.html`. Token/state reference: `mockups/ui-plan.md`.

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

"Tier 3 is state-only" was asserted without checking and is false. The slot pills carry **9
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

The glyph audit is worse than tier 1's: `mdiRefresh` appears **four times** on one card with
four different scopes, `mdiPlus` twice. Invariant 4 violated six times — invisible precisely
because each pill is locally reasonable. Only counting across the card exposes it.

**Four refreshes collapse to one.** Nobody wants to refresh *only* goals; per-slot refetch is
data plumbing leaking into the UI. A non-refetch maintenance action (KB reindex) stays
distinct.

**`Archive` / `Specs` move rather than die.** They are navigation, and the case for deleting
them (the board they duplicate is one pill-click away, as with `mdiOpenInNew`) was rejected —
they are used often enough to keep a shortcut, just not a permanent button.

Net: **9 pill buttons → 0**; the menu grows to 13 items across 5 groups.

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

No glyph may mean two things on the same card. Verified against **225** distinct MDI glyphs
in tracked sources.

| Action | Glyph | Note |
|---|---|---|
| Add to workspace | `mdiViewGridPlus` | unchanged; **reserved** — this meaning only |
| Remove from workspace | `mdiClose` | unchanged |
| Pin directory | `mdiPin` | unchanged |
| Float blocked to top | `mdiSortVariant` | unchanged |
| Directory settings | `mdiCog` | unchanged |
| Folder actions menu | `mdiDotsHorizontal` | new |
| **Project setup** | **`mdiTextBoxCheckOutline`** | replaces `mdiFolderPlusOutline`, which read as "add a folder" beside the card's own `mdiFolderOpen` |
| **Run init hook** | **`mdiScriptTextPlayOutline`** | replaces `mdiCogPlayOutline`, which collided with `mdiCog` |
| Init failed | `mdiAlertCircleOutline` | |
| Clean up broken | `mdiBroom` | unchanged |

**Rejected for project setup:** `mdiSproutOutline` (means "something begins here" — wrong
for an idempotent top-up), `mdiFileTreeOutline` / `mdiPuzzleOutline` / `mdiCompassOutline` /
`mdiFormatListChecks` / `mdiClipboardCheckOutline` (all already in use),
`mdiRocketLaunchOutline` ("launch" wanted later for run/deploy), `mdiAutoFix` (may be wanted
for generic AI-generate), `mdiCheckDecagramOutline` (reads as a passive badge).

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
