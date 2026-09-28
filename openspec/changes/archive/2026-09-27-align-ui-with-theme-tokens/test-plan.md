# Test Plan — align-ui-with-theme-tokens

Stage: design   Generated: 2026-09-27

Gate note: no open clarifications. Scope, recipe and surfaces were chosen by the user; thresholds come from WCAG 2.2 AA (1.4.3 contrast, 2.5.8 target size) and the existing `ui-contract.md` dense-text row.

Harness notes: "computed contrast" = the in-page routine from `mockups/ux-probe.cjs` (canvas-resolved colour, ancestor backgrounds composited). axe alone is insufficient: it marks semi-transparent backgrounds "incomplete" (live "New Session" 1.70:1 reported OK). L3 rows run against the docker harness (`docker/test-up.sh`) with a seeded goal, an opened worktree dialog, an opened automation dialog and a select-prompt fixture. Pattern exemplars: `tests/e2e/severity-contrast.spec.ts`, `packages/client/src/lib/__tests__/theme-body-text-contrast.test.ts`.

Existing tests that must change (doubt-review #3/#5): `GoalDetailClaim.test.tsx:125,134` (emerald gauge class), `pi-runtime-picker.spec.ts:514` + `settings-page-composition.test.tsx:451` ("Sessions spawn"), `doctor-core.test.ts` + `diagnostics-spawn-runtime.spec.ts:40` (doctor "Spawn runtime"). Tracked as tasks 2.9–2.10, not as scenario rows.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | tints: severity values unchanged | invariant | L3 | automated | 18 theme×mode combos; committed baseline `tests/e2e/fixtures/severity-baseline.json` of computed `--severity-{success,warning,info,error}-{bg,fg}` (task 4.3, captured before task 1.1) | browser computes each probe's `getComputedStyle` colour (jsdom cannot resolve `color-mix`) | every rgb value identical to baseline |
| E2 | tints: contrast gate | BVA (per theme) | L3 | automated | 18 theme×mode combos × tints green/orange/blue/purple/red, as a separate `TINT_TIERS` sweep (`ALL_TIERS` untouched, so its distinct-bg test still holds) | `severity-contrast.spec.ts` with probes parameterized by token prefix | every cell ≥ 3:1 except tokyo-night/light `blue`,`purple` ≥ 2.5; ≥ 4.5 on default dark + light; ≥ 55 of 90 tint cells meet 4.5 |
| E3 | no palette literals on surfaces | EP | L1 | automated | the spec surface list (9 files + `OpenSpecBoardView.tsx` controls) | regex scan of `className`/`style` for `(text\|bg\|border\|ring\|outline\|divide\|shadow\|from\|via\|to)-(green\|orange\|blue\|yellow\|indigo\|red\|amber\|purple\|emerald\|sky)-\d`, `#[0-9a-fA-F]{3,8}`, `rgba(` | 0 matches |
| E4 | status colour on shape only | decision-table | L1 | automated | `SessionCard` rendered in each status incl. resuming | RTL render, read computed class of status word and shape | word uses `--text-secondary`; shape uses `--status-*`; no `--status-*` on text nodes |
| E5 | text-muted only for decoration | EP | L1 | automated | the spec surface list (9 files + `OpenSpecBoardView.tsx` controls) | scan `--text-muted` uses | every use is a `disabled:` variant or on an element with `aria-hidden="true"`; 0 other uses |
| E10 | readable labels across named themes | BVA (per theme) | L3 | automated | worktree dialog (opened) in each of the 18 theme×mode combos | computed contrast of headings, labels and help text | every node ≥ 3:1; ≥ 4.5:1 in default dark + light |
| E7 | copy: no spawn wording | EP | L1 | automated | `i18n-en-source.json`, plugin `src/i18n.ts` English catalogs, every `i18nT`/`t` fallback, `configSchema.json` title/description, and every prose-like string literal (contains a space or starts uppercase) in non-test `packages/*/src/**/*.{ts,tsx}`; allowlist `packages/client/src/lib/__tests__/ui-copy-allowlist.json` for log-only / internal strings (task 4.4) | regex `\b(re)?spawn(s\|ed\|ing)?\b` case-insensitive | 0 matches |
| E8 | copy: keys + translations stable | invariant | L1 | automated | key sets of en-source, `i18n-hu.ts`, zh map in `lib/i18n/i18n.tsx`, plugin `src/i18n.ts` maps, `i18n-legacy-aliases.ts` before (git `HEAD~`) and after | diff | no key removed or renamed; hu values identical; zh identical except goal-plugin `autoRespawn*` 重生 → 重启 |
| E9 | copy: exact labels | decision-table | L1 | automated | D9 table rows `git.spawnIntoThatWorktree`, `autoRespawnLabel`, `fieldCount`, `session.spawnASessionAttachedToThis` | render `WorktreeSpawnDialog` collision, goal settings, automation dialog, OpenSpec board row (RTL) | visible text equals the D9 "new" column |
| E6 | disabled primary keeps legible text | BVA | L1 | automated | worktree Create button with `canSubmit=false` | RTL render | classes `disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)]` present |

### Frontend quirks

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| F1 | spawn tray contrast | pairwise (theme × button) | L3 | automated | folder card of a pinned repo | dark and light; computed contrast on "New Session" / "New Worktree" | each ≥ 4.5:1; computed bg equals `--tint-green-bg` / `--tint-orange-bg` (tint fg on its own bg) |
| F2 | session card chips | pairwise | L3 | automated | card with Fork / +Session / Worktree / Archive anyway chips and worktree badge | dark and light, 375 and 1280 | contrast ≥ 4.5:1; each tinted chip's computed bg is its `--tint-*-bg`; text ≥ 12 px (badge ≥ 11 px); targets ≥ 44×44 at 375, ≥ 32 px tall at 1280 |
| F3 | worktree dialog | pairwise | L3 | automated | dialog opened from tray, fork mode with a colliding branch name | dark and light, 375 and 1280 | headings ≥ 4.5:1 and ≥ 12 px; source toggle ≥ 44×44 / ≥ 32 px; collision block `--severity-warning-*` ≥ 4.5:1; Create button `--accent-solid` + white ≥ 4.5:1 |
| F4 | goal detail controls | pairwise | L3 | automated | seeded goal with 2 verdicts, 1 linked session | dark and light, 375; Tab through loop controls | every control ≥ 44×44 at 375; focus ring visible on each; delete `--tint-red-*`, + New session `--tint-purple-*`, contrast ≥ 4.5:1 |
| F5 | select / confirm prompt | EP | L3 | automated | select-prompt fixture (2 options) and confirm fixture | dark and light, 375 | options ≥ 44 px tall, ≥ 12 px, ≥ 4.5:1 |
| F6 | automation dialog help | EP | L3 | automated | automation dialog opened on an existing automation with missing file path | dark and light | subtitle, next-run, locked-name and file-path help ≥ 12 px, `--text-secondary` ≥ 4.5:1; error text `--severity-error-fg` ≥ 4.5:1; enabled badge `--tint-green-*` |
| F7 | axe on changed surfaces | invariant | L3 | automated | F1–F6 surfaces | axe `wcag2a/2aa/21aa/22aa` scoped to each surface, dark and light | 0 violations |
| F8 | keyboard focus | state-transition | L3 | automated | every button on F1–F6 surfaces | focus each via Tab | computed outline or ring present on each |
| F9 | no layout regression | BVA | L3 | automated | sidebar at 320 px min width, folder card with 3 sessions | render | no horizontal overflow; chip row wraps instead of clipping |
| F11 | secondary surfaces | pairwise | L3 | automated | dashboard-level new-session tray (`DashboardSpawnButtons`), OpenSpec board row + new-change dialog controls, `ManageWorktreesDialog` list | dark and light, 375 and 1280 | contrast ≥ 4.5:1 on default themes; controls ≥ 44×44 at 375, ≥ 32 px at 1280; text ≥ 12 px; tinted text on its own tint bg |
| F10 | visual match to mockup | EP | manual-only | manual-only | `mockups/index.html` A1–A6 vs rebuilt live surfaces | side-by-side screenshots dark + light | reviewer confirms same recipe (hue, weight, radius, spacing); differences listed |

### Error handling

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | error text readable | EP | L3 | automated | worktree dialog `branch_exists` error; automation missing-file error | dark and light | error text uses `--severity-error-fg`, ≥ 12 px, ≥ 4.5:1 |

### Performance

None: visual-only change, no data path.

---

## Coverage summary

edge 10 · perf 0 · frontend 11 · error 1  ·  L1 7 · L2 0 · L3 14 · manual-only 1  ·  automated 21 · manual-only 1

## UX baseline

`mockups/ux-probe.cjs`: live folder card **3/10**, after-mockup **10/10** (details in `mockups/ux-test.md`). F1–F9 port the probe to Playwright.

## New infra needed

- Severity baseline fixture (task 4.3) and copy-scan allowlist (task 4.4).

- Shared computed-contrast helper for Playwright (`tests/e2e/helpers/computed-contrast.ts`) extracted from `mockups/ux-probe.cjs`.
- Harness seeding: one goal with verdicts and a linked session; one automation with a missing file path; select/confirm prompt fixtures (reuse existing prompt fixtures if present).
