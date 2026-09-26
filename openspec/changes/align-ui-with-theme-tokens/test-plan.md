# Test Plan — align-ui-with-theme-tokens

Stage: design   Generated: 2026-09-27

Gate note: no open clarifications. Scope, recipe and surfaces were chosen by the user; thresholds come from WCAG 2.2 AA (1.4.3 contrast, 2.5.8 target size) and the existing `ui-contract.md` dense-text row.

Harness notes: "computed contrast" = the in-page routine from `mockups/ux-probe.cjs` (canvas-resolved colour, ancestor backgrounds composited). axe alone is insufficient: it marks semi-transparent backgrounds "incomplete" (live "New Session" 1.70:1 reported OK). L3 rows run against the docker harness (`docker/test-up.sh`) with a seeded goal, an opened worktree dialog, an opened automation dialog and a select-prompt fixture. Pattern exemplars: `tests/e2e/severity-contrast.spec.ts`, `packages/client/src/lib/__tests__/theme-body-text-contrast.test.ts`.

No existing component test asserts palette classes on the 8 surfaces (checked by grep), so no test updates are expected beyond the new rows.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | tints: severity values unchanged | invariant | L1 | automated | `index.css` before (git `HEAD~`) and after; every theme × light/dark | resolve `--severity-{success,warning,info,error}-{bg,fg,border}` via the theme-var resolver used by `theme-body-text-contrast.test.ts` | resolved strings identical |
| E2 | tints: contrast gate | BVA (per theme) | L1 | automated | every theme × light/dark; hues green/orange/blue/purple/red | composite `--tint-<hue>-fg` over `--tint-<hue>-bg` | ≥ 4.5:1, or the same documented per-theme exception list as the severity gate |
| E3 | no palette literals on surfaces | EP | L1 | automated | the 8 surface files | regex scan of `className`/`style` for `(text\|bg\|border)-(green\|orange\|blue\|yellow\|indigo\|red\|amber\|purple\|emerald\|sky)-\d`, `#[0-9a-fA-F]{3,8}`, `rgba(` | 0 matches |
| E4 | status colour on shape only | decision-table | L1 | automated | `SessionCard` rendered in each status incl. resuming | RTL render, read computed class of status word and shape | word uses `--text-secondary`; shape uses `--status-*`; no `--status-*` on text nodes |
| E5 | text-muted only for decoration | EP | L1 | automated | the 8 surface files | scan `--text-muted` uses | every use is a `disabled:` variant or on an element with `aria-hidden="true"`; 0 other uses |
| E6 | disabled primary keeps legible text | BVA | L1 | automated | worktree Create button with `canSubmit=false` | RTL render | classes `disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)]` present |

### Frontend quirks

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| F1 | spawn tray contrast | pairwise (theme × button) | L3 | automated | folder card of a pinned repo | dark and light; computed contrast on "New Session" / "New Worktree" | each ≥ 4.5:1; tokens `--tint-green-*` / `--tint-orange-*` in computed style chain |
| F2 | session card chips | pairwise | L3 | automated | card with Fork / +Session / Worktree / Archive anyway chips and worktree badge | dark and light, 375 and 1280 | contrast ≥ 4.5:1; text ≥ 12 px (badge ≥ 11 px); targets ≥ 44×44 at 375, ≥ 32 px tall at 1280 |
| F3 | worktree dialog | pairwise | L3 | automated | dialog opened from tray, fork mode with a colliding branch name | dark and light, 375 and 1280 | headings ≥ 4.5:1 and ≥ 12 px; source toggle ≥ 44×44 / ≥ 32 px; collision block `--severity-warning-*` ≥ 4.5:1; Create button `--accent-solid` + white ≥ 4.5:1 |
| F4 | goal detail controls | pairwise | L3 | automated | seeded goal with 2 verdicts, 1 linked session | dark and light, 375; Tab through loop controls | every control ≥ 44×44 at 375; focus ring visible on each; delete `--tint-red-*`, + New session `--tint-purple-*`, contrast ≥ 4.5:1 |
| F5 | select / confirm prompt | EP | L3 | automated | select-prompt fixture (2 options) and confirm fixture | dark and light, 375 | options ≥ 44 px tall, ≥ 12 px, ≥ 4.5:1 |
| F6 | automation dialog help | EP | L3 | automated | automation dialog opened on an existing automation with missing file path | dark and light | subtitle, next-run, locked-name and file-path help ≥ 12 px, `--text-secondary` ≥ 4.5:1; error text `--severity-error-fg` ≥ 4.5:1; enabled badge `--tint-green-*` |
| F7 | axe on changed surfaces | invariant | L3 | automated | F1–F6 surfaces | axe `wcag2a/2aa/21aa/22aa` scoped to each surface, dark and light | 0 violations |
| F8 | keyboard focus | state-transition | L3 | automated | every button on F1–F6 surfaces | focus each via Tab | computed outline or ring present on each |
| F9 | no layout regression | BVA | L3 | automated | sidebar at 320 px min width, folder card with 3 sessions | render | no horizontal overflow; chip row wraps instead of clipping |
| F10 | visual match to mockup | EP | manual-only | manual-only | `mockups/index.html` A1–A6 vs rebuilt live surfaces | side-by-side screenshots dark + light | reviewer confirms same recipe (hue, weight, radius, spacing); differences listed |

### Error handling

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | error text readable | EP | L3 | automated | worktree dialog `branch_exists` error; automation missing-file error | dark and light | error text uses `--severity-error-fg`, ≥ 12 px, ≥ 4.5:1 |

### Performance

None: visual-only change, no data path.

---

## Coverage summary

edge 6 · perf 0 · frontend 10 · error 1  ·  L1 6 · L2 0 · L3 10 · manual-only 1  ·  automated 16 · manual-only 1

## UX baseline

`mockups/ux-probe.cjs`: live folder card **3/10**, after-mockup **10/10** (details in `mockups/ux-test.md`). F1–F9 port the probe to Playwright.

## New infra needed

- Shared computed-contrast helper for Playwright (`tests/e2e/helpers/computed-contrast.ts`) extracted from `mockups/ux-probe.cjs`.
- Harness seeding: one goal with verdicts and a linked session; one automation with a missing file path; select/confirm prompt fixtures (reuse existing prompt fixtures if present).
