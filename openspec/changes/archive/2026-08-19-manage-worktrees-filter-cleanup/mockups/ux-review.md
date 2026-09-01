# UX review — worktree list mockup

Mockup: `openspec/changes/manage-worktrees-filter-cleanup/mockups/index.html`
States: `/` (default) · `/?demo=all` (revealed) · `/?demo=err` (batch partial failure) · `+`/`?demo=light`

## Rubric (score derived per check, not eyeballed)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Contrast WCAG AA — dark | PASS | all text on `--text-secondary` (7.7–8.5:1) or `--text-primary` (14.6:1); severity-error-fg 7.05:1 |
| 2 | Contrast WCAG AA — light | PASS | `--text-secondary` 9.3:1; severity-error-fg 6.98:1 — **after** retiring `--text-tertiary` (measured 4.28:1, below floor) |
| 3 | Responsive 375/768/1440 | PASS | no overflow at any width; row-error stacks below 640px |
| 4 | Target size ≥44px mobile | PASS | `.rm` 44×44, `.cbwrap` 44×56, `.btn`/`.themebtn` 44 min-height, recovery button full-width 44 |
| 5 | Hierarchy — one focal action | PASS | spawn: `+Session →` only; manage: `Remove N worktrees` only (prune demoted to a footer link) |
| 6 | Spacing rhythm | PASS | 8/10/14/16 from the app's shipped scale; row 48 desktop / 56 mobile |
| 7 | Token fidelity | PASS | every value traces to `packages/client/src/index.css`; **no new token required** |
| 8 | Anti-slop | PASS | real `git worktree list` fixture, no purple, no gradient, no glow, no eyebrow, app's own mono/sans + 11/12px scale |
| 9 | Console clean | PASS | no errors across all 4 demo states |
| 10 | Color not sole channel (WCAG 1.4.1) | PASS | errors carry `⚠` + text + left border; chips carry `+`/`−` + count, not just fill |
| 11 | Error states name cause AND fix | PASS | "Uncommitted changes — Modified or untracked files present. Nothing was removed." + `Retry with --force` |
| 12 | Error summary links to each failure | PASS | GOV.UK pattern, anchors to the per-row strip |

**Score 12/12.** No open WCAG-AA or severity-4 defect.

## Defects found and fixed during the loop

| Sev | Defect | Fix | Rule |
|---|---|---|---|
| 3 | `direction:rtl` left-truncation relocated leading punctuation — `.worktrees/x` rendered as `worktrees/x.`, silently corrupting the identifier | elide in JS by path segment; never bidi | — |
| 4 | Path — the only unique key in manage mode — truncated to nothing at 375px | two-line row: identity over path; strip the constant `.worktrees/` prefix | NN/g data-tables: design around the task |
| 3 | `--text-muted` on `--bg-secondary` = **2.59:1** | retired from this surface | WCAG 1.4.3 |
| 3 | `--text-tertiary` on `--bg-secondary` light = **4.28:1** | retired from this surface | WCAG 1.4.3 |
| 2 | destructive primary wrapped to its own line below a secondary button | primary pinned right of the bulk bar; prune → footer link | NN/g modal: one visually-primary action |
| 2 | chip `Detached 5` ambiguous — could read "5 shown" | `+ detached 5` / `− detached 5` states the action | Nielsen #1 |
| 2 | path line duplicated the branch slug on derived rows | suppress when `rel(path) === slugifyBranch(branch)` | Nielsen #8 |
| 2 | mobile row-error squeezed the diagnosis into a 6-word column | wrap + full-width recovery button below 640px | NN/g error-message-guidelines |

## Two token rules this surface establishes

1. **`--text-muted` and `--text-tertiary` MUST NOT carry text on this surface.**
   Measured against the shipped backgrounds: `--text-muted` fails AA in dark
   (2.59:1) and `--text-tertiary` fails in light (4.28:1). Both are usable for
   borders/glyph fills, not for text. The shipped `WorktreeSpawnDialog` §1
   currently renders branch and path in exactly these two tokens — so the
   extraction fixes a pre-existing contrast defect rather than introducing one.

2. **`.worktrees/` is chrome, not data.** It prefixes every in-tree row
   identically, so it belongs in the section hint once, not on N rows.
