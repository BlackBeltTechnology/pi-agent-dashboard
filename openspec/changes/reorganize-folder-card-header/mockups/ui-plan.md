# UI plan — folder card header reorganization

Mockup: `index.html` — variant **A (current)** vs **D (chosen)**, plus every status-capsule
state, every tier-0 banner state, and a full "what moved where" table. Dark/light toggle +
narrow-sidebar toggle. Serve with `serve_mockup`.

## Ground truth

Source: `packages/client/src/components/session/SessionList.tsx` (`renderGroup`, ~1010–1180,
`renderAddToWorkspaceButton` ~948), `packages/client/src/components/folder/FolderNeedsYouPill.tsx`,
`packages/client/src/components/folder/FolderActionBar.tsx`,
`packages/client/src/components/session/SessionCard.tsx` (`renderAddToWorkspace` prop).

## Problems

1. **Scope error** — the `Workspace` pill acts on `session.cwd`, i.e. on the *directory*,
   yet renders once per session card. N sessions = N buttons, 1 effect.
2. **Redundant navigation** — the header row click and `mdiOpenInNew` share a destination.
   The icon renders only on pinned/workspace rows: present where the gesture is already
   learned, absent where it would teach.
3. **Three notification surfaces** — `(723)`, `FolderNeedsYouPill`, and `FolderStatusRollup`
   (collapsed only). Liveness disappears exactly when you expand to inspect it.
4. **No colour scarcity** — actions and the attention pill sit at equal weight in tier 1,
   diluting the pre-attentive purple signal.
5. **Mutations have no single home** — pin, sort, workspace-add, workspace-remove, and
   settings are scattered across two rows and a per-session card.

## Chosen design — D

```
TIER 1  identity + urgency     📂 …/pi-agent-da…    [💬4 │ ●2 │ 717]   ⋯
TIER 2  git facts, no buttons  ⑂ develop   ● 2 uncommitted
TIER 0  call-to-action banner  ⚠ Initialize failed — pnpm install exit 1   [Retry]
TIER 3  directory state pills  AUTOMATIONS │ GOALS │ KB │ OPENSPEC
```

Tier 0 sits *below* tier 2 (so identity + urgency stay at the top of the card) but is
numbered 0 because it outranks everything in importance when present. It does not render
when the folder needs nothing.

**Invariants**

1. **Pills read a number, the menu changes something.** No exceptions — which is why
   `Workspace` did *not* join the tier-3 grid.
2. **Tier 2 is facts only.** No controls beyond the branch/dirty affordances themselves.
3. **A call to action is never a button in a row** — it is a banner with a sentence.

### `⋯` menu contents

| Group | Items |
|---|---|
| WORKSPACE | Add to workspace… · Remove from workspace *(workspace rows only)* |
| DIRECTORY | Pin directory · Float blocked to top *(state suffix)* · Directory settings… |

### Status capsule

Severity-ordered segments, only the leading tier tinted. Segments are individual
buttons; the trailing idle count is inert.

Severity order: **needs-you > error > working > idle**. A human actively waiting outranks
a crash — the crash is already over, the wait is not.

| State | Render | Lead token |
|---|---|---|
| blocked + error | `💬4 · ⚠1 · ●2 · 716` | `--status-needs-you` |
| blocked on you | `💬4 · ●2 · 717` | `--status-needs-you` |
| working only | `●2 · 721` | `--status-working` |
| all idle | `723` | none (`--text-muted`) |
| empty folder | `0` | none |
| narrow sidebar | idle segment drops first; the alert segment never drops | — |

Renders identically collapsed and expanded (today's rollup is collapsed-only).

## Tokens (no raw hex; all from `packages/client/src/index.css`)

| Use | Token |
|---|---|
| card surface | `color-mix(in srgb, var(--accent-blue) 5%, var(--bg-primary))` |
| card border | `color-mix(in srgb, var(--accent-blue) 22%, var(--border-subtle))` |
| blocked-on-you | `var(--status-needs-you)` |
| working | `var(--status-working)` |
| error | `var(--status-error)` |
| idle / inventory | `var(--text-muted)` |
| dirty worktree | `var(--accent-orange)` |
| segment lead fill | `color-mix(in srgb, var(--seg) 14%, transparent)` |
| icon button rest → hover | `var(--text-tertiary)` → `var(--text-primary)` + `var(--bg-hover)` |
| tier-0 banner | `--severity-{info,warning,error}-{bg,fg,border}` |

The `--severity-*` triples are already documented in `index.css` as "the single color source
of truth for every toast / banner surface" (change: `unify-message-severity-colors`). A
tier-0 banner is exactly that surface, so it introduces **no new tokens**.

## Tier 0 — banner states

| Trigger | Severity | Copy | Action |
|---|---|---|---|
| cwd is not a pi project | info | **Not a pi project yet** · Scaffold AGENTS.md, .pi/settings.json and prompts | `Set up →` |
| init hook exists, never run | warning | **Not initialized** · worktree init hook available | `Initialize` |
| init running | warning | **Initializing…** · `<cmd>` · elapsed | `Logs` |
| init failed | error | **Initialize failed** · `<cmd>` — exit N | `Retry` |
| N broken sessions (`cwdMissing`) | warning | **N broken sessions** · cwd no longer exists | `Clean up` |

Banners stack, blocking-first (error → warning → info). Realistic maximum is two.
Animation on the running spinner must respect `prefers-reduced-motion`.

### Banner truncation contract

The subline is unbounded — it names missing artifacts, a failing command, or a path. The
layout must clip it, and the trailing action must never be overlapped. Four rules, all
required together:

| Element | Rule | Why |
|---|---|---|
| `.banner` | `display:flex` | icon · text · action row |
| text region | `min-width:0; overflow:hidden` | a flex item's default `min-width:auto` refuses to shrink below its content |
| headline **and** subline | `display:block` + `white-space:nowrap; overflow:hidden; text-overflow:ellipsis` | **`overflow` and `text-overflow` are ignored on inline boxes** — an inline `<span>` silently refuses to ellipsis and overflows instead |
| action control | `flex:none` | never compressed by long text |

The `display:block` rule is the trap: the mockup originally had every other rule right, so
the subline *looked* like it was configured to truncate while actually spilling under the
button. Tailwind equivalent: `min-w-0 overflow-hidden` on the text column, `block truncate`
on each line, `shrink-0` on the action.

## Constraints

- Header row keeps `min-h-[44px] md:min-h-0` (WCAG 2.5.5 target size).
- `⋯` needs `aria-haspopup="menu"` + `aria-expanded`, matching the existing
  add-to-workspace popover contract. Menu items need `role="menuitem"`.
- Capsule segments are `<button>`s with distinct `aria-label`s
  ("4 sessions blocked on you — go to first"), not a single ambiguous target.
- The `addToWsMenuFor` scope key survives (`folder:<cwd>`); the
  `session:<id>` scope disappears with the session-card pill.

## Test-id migration

| Test id | Fate |
|---|---|
| `add-to-workspace-btn-<cwd>` | moves inside `⋯`; **E2E needs a menu-open step** — `tests/e2e/folder-membership-drag.spec.ts:151,171,194` clicks it directly |
| `session-card-add-to-workspace-<id>` | **deleted** |
| `folder-urgency-sort-<cwd>` | moves inside `⋯` |
| `folder-open-home-<cwd>` | **deleted** (row click remains, `folder-home-row-<cwd>`) |
| `pin-dir-btn` / `unpin-dir-btn` | move inside `⋯` |
| `ws-remove-<wsId>-<cwd>` | moves inside `⋯` |
| `folder-cleanup-broken-btn` | moves into the tier-0 banner |
| — | **new**: `folder-actions-menu-<cwd>`, `folder-status-capsule-<cwd>`, `folder-capsule-seg-{needsyou,working,error,idle}-<cwd>`, `folder-banner-<kind>-<cwd>` |

Affected components: `FolderActionBar.tsx` loses `ProjectInitButton` /
`WorktreeInitButton` / cleanup and may disappear entirely once the gear moves to `⋯`.

## Superseded

`compact-session-card-workspace-pill` — withdrawn and deleted. It resized a control that
this change removes; a scope error was misdiagnosed as a sizing error.

## Resolved

- **Severity order** → needs-you above error.
- **`Initialize` / `Set up project`** → promoted to a tier-0 banner, taking
  `Clean up broken` and `WorktreeInitChip` with it. Tier 2 becomes fact-only with no
  exception.

## Open questions

1. **Tier-0 vertical cost.** A banner is ~34px per folder. With many unconfigured folders
   pinned, the sidebar could fill with banners. Cap at one banner + "+N more"?
2. **`Commit` link merged into the `2 uncommitted` chip.** Removes a target but makes an
   informational chip clickable — mild inconsistency with the inert idle segment.
3. **Pin discoverability.** Pinning is how an unpinned folder becomes sticky — the one
   action a *new* user must find, now one click deeper.
4. **Banner placement.** Below tier 2 keeps identity at the top, but an unconfigured
   directory has no tier 2, so the banner floats directly under tier 1 — two different
   visual positions for the same element.
