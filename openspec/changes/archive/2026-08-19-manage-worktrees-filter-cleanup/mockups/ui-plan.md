# UI plan — manage-worktrees-filter-cleanup

Surfaces → tokens → states. Every value references a token from
`packages/client/src/index.css`. No raw hex, no px literal that is not already
a shipped utility.

## Surfaces

| Surface | Mode | Host | Primary action (Von Restorff — exactly one) |
|---|---|---|---|
| `WorktreeSpawnDialog` §1 | `spawn` | existing `+Worktree` fullscreen dialog | row click → `+Session →` |
| Manage worktrees | `manage` | `FolderActionsMenu` → `directory` group → `Dialog size="lg"` | `Remove N worktrees` (bulk bar) |

Both render the same `WorktreeList`. Mode changes affordances, never layout.

## Grounded tokens (harvested from shipped source, not invented)

| Role | Token | Shipped precedent |
|---|---|---|
| Row hover | `--bg-hover` | `WorktreeSpawnDialog` §1 row |
| List container border | `--border-subtle` | `WorktreeSpawnDialog` §1 wrapper |
| Row divider | `--border-subtle` | `border-b … last:border-b-0` |
| Filter input bg / border | `--bg-tertiary` / `--border-secondary` | `BranchPicker.tsx:84` |
| Filter input focus | `focus:border-blue-500` | `BranchPicker.tsx:84` |
| Chip ON | `border-blue-500` `text-blue-400` `bg-blue-500/10` | `WorktreeSpawnDialog` source-mode toggle |
| Chip OFF | `--border-subtle` / `--text-muted` → hover `--text-primary` | same toggle |
| Branch text | `--text-primary` | §1 row used `--text-tertiary` — **fails AA in light, 4.28:1** |
| Path text | `--text-secondary` | §1 row used `--text-muted` — **fails AA in dark, 2.59:1** |
| `main` badge | `--border-subtle` pill, `--text-secondary` | §1 row |
| Destructive intent | `--accent-red` / `--severity-error-*` | `Dialog.Action intent="danger"` |
| Detached badge | `--severity-neutral-*` | severity token family |
| Elevation of bulk bar | `--bg-secondary` + `--border-primary` | panel convention |

**No new token is required.** The surface is expressible entirely in the shipped
palette — which is the point of the CONTRACT step.

### Contrast floor (measured, not assumed)

`--text-muted` and `--text-tertiary` MUST NOT carry text here. Measured against
the shipped backgrounds:

| Token | on `--bg-secondary` dark | on `--bg-secondary` light | verdict |
|---|---|---|---|
| `--text-muted` | **2.59:1** | — | fails AA |
| `--text-tertiary` | 4.67:1 | **4.28:1** | fails AA (light) |
| `--text-secondary` | 8.5:1 | 9.3:1 | passes |
| `--text-primary` | 14.6:1 | 16.7:1 | passes |

The shipped §1 row renders branch in `--text-tertiary` and path in
`--text-muted`, so extracting `WorktreeList` **fixes a pre-existing contrast
defect**. That is a behaviour change worth calling out in tasks.md, not a silent
restyle.

## States

| State | Rendering | Rule |
|---|---|---|
| Loading | existing `Loading…` text, not a spinner | NN/g response-times: <1s preserves flow; `git worktree list` is local |
| Default (filtered) | 3 of 8 rows + chips carrying hidden counts | Hick's Law; Nielsen #8 |
| All revealed | 8 rows, chips lit | Nielsen #1 visibility of system status |
| Empty after query | "No worktree matches `<query>`" + `Clear filter` | NN/g empty-state: name the escape hatch |
| Zero worktrees | "Only the main worktree exists." + pointer to §2 | NN/g empty-state: show the shape of success |
| Row selected | `--bg-selected` + checkbox checked | Gestalt common region |
| Row removing | row dims, inline `Removing…` | Nielsen #1 |
| Row failed | inline severity-error strip **at the row** + summary count at top | GOV.UK error-summary + NN/g: inline at field AND summary |
| Main row | no `✕`, no checkbox, `main` badge retained | Nielsen #5 error prevention |

## Cited rules governing this surface

| Decision | Rule | Source |
|---|---|---|
| Default filter hides 5 of 8 rows | Hick's Law — decision time grows with choices | lawsofux.com/hicks-law |
| Hidden rows always show a live count | Nielsen #1 visibility of system status; #6 recognition not recall | nngroup.com/articles/ten-usability-heuristics |
| `✕` opens a confirm, never removes directly | Nielsen #5 — confirm destructive/irreversible actions | NN/g confirmation-dialog |
| Button reads `Remove 3 worktrees`, not `OK` | Button labels = outcome verbs | NN/g ui-copy |
| Per-row failure shown inline **and** summarised | error summary links to each failing item | GOV.UK error-summary pattern |
| Failure conveyed by icon + text + border, not color alone | WCAG 1.4.1 use of color | w3.org/TR/WCAG22 |
| `✕` / checkbox hit area ≥ 24×24 (44 on mobile) | WCAG 2.5.8 target size (AA) + Fitts's Law | w3.org/TR/WCAG22 |
| Filter is in-page search on a scan-and-act list | design the table around the task | NN/g data-tables |
| Long paths elide by segment in JS, never `direction:rtl` | bidi reorders leading `.`, printing `.worktrees/x` as `worktrees/x.` | WCAG 1.3.2 meaningful sequence |
| `.worktrees/` stripped from every row, stated once in the hint | constant across rows = no information, costs the width that distinguishes siblings | Nielsen #8 |
| Path line suppressed when `rel(path) === slugifyBranch(branch)` | do not say the same thing twice | Nielsen #8 |
| Branch wraps (not truncates) below 640px | no hover on touch → truncate-with-tooltip has no tooltip | NN/g data-tables |
| Manage mode lives behind a menu, not in the spawn dialog | progressive disclosure — defer secondary options | NN/g progressive-disclosure |
| One primary action per dialog, cancel subordinate | modal has one visually-primary action | NN/g modal-nonmodal |

## Anti-slop bindings

- Fixture data is **this machine's real `git worktree list`** — `os/reduce-bridge-tick-bandwidth`, `.worktrees/ab-impl/auth-redirect-gaps`, the `/private/var/folders/…/tmp.AH18lnlujb` harness leftover. No `feature/foo`, no Acme.
- Palette is the shipped token set. `--accent-purple` is reserved for
  `--status-needs-you` and MUST NOT appear as decoration here.
- No gradient, no glow, no eyebrow label above each section.
- Type is the app's existing mono/sans pairing at the app's existing
  `text-[11px]` / `text-xs` scale — not a fresh scale.
