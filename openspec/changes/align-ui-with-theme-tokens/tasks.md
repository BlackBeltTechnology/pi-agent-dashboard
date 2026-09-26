## 1. Tokens

- [ ] 1.1 `packages/client/src/index.css`: add `--tint-{green,orange,blue,purple,red}-{bg,fg,border}` beside `--severity-*` with the identical `color-mix` formula (D1); redefine `--severity-{success,warning,info,error}-*` as `var(--tint-*)` aliases; comment cites this change

## 2. Surfaces (D2–D6; mockup `mockups/index.html` A1–A6)

- [ ] 2.1 `packages/client/src/components/folder/FolderSpawnButtons.tsx` (A1): green/orange palette → `--tint-green-*` / `--tint-orange-*`; keep `focus-ring`, 44 px mobile height
- [ ] 2.2 `packages/client/src/components/session/SessionCard.tsx` (A2): action chips → tints, `text-[12px]`, `min-h-[44px] sm:min-h-[32px] px-2.5`, `focus-ring`; worktree badge `text-[11px]` `--severity-neutral-*` (no uppercase-muted); "Resuming…" `--text-secondary` with status colour on the shape only (D2b); remaining `--text-muted` → `--text-secondary` except `aria-hidden` glyphs
- [ ] 2.3 `packages/client/src/components/worktree/WorktreeSpawnDialog.tsx` (A3): section headings `text-[12px] font-semibold text-[var(--text-secondary)]`; source toggle → `--tint-blue-*` when pressed, 44/32 px; field labels `--text-primary` 12–13 px; collision/orphan/branch-reuse blocks → `--severity-warning-*`; error text → `--severity-error-fg`; Create → `bg-[var(--accent-solid)] text-white` + disabled recipe (D4); Cancel secondary recipe; `focus-ring` on every button
- [ ] 2.4 `packages/client/src/components/worktree/WorktreeList.tsx` (A3): row text sizes ≥ 12 px (path 11 px dense), row buttons 44/32 px, `focus-ring`, muted → secondary
- [ ] 2.5 `packages/goal-plugin/src/client/GoalDetailClaim.tsx` (A4): loop controls → secondary recipe 44/32 px `text-[12px]`; `indigo-*` → `--tint-purple-*`; delete → `--tint-red-*`; verdict pills → tints; `focus-ring` everywhere
- [ ] 2.6 `packages/client/src/components/interactive-renderers/{ConfirmRenderer,SelectRenderer}.tsx` (A5): option buttons `min-h-[44px] sm:min-h-[36px] text-[13px]`, remaining palette classes → tokens, `focus-ring`
- [ ] 2.7 `packages/automation-plugin/src/client/CreateAutomationDialog.tsx` (A6): `text-[10px] --text-muted` help → `text-[12px] --text-secondary`; `#6ee7b7`/`rgba(52,211,153,…)` badge → `--tint-green-*`; buttons 44/32 px + `focus-ring`

## 3. Contract + docs

- [ ] 3.1 `ui-contract.md`: primary-button row → D4 recipe; add "Colour roles" table (tint / severity / status, D2), "status colour on shape, not text" (D2b), text floors (≥ 11 px, interactive ≥ 12 px) and target floors (44 px mobile, 32 px `sm:`) (D5), `--text-muted` only for disabled + `aria-hidden` (D3)
- [ ] 3.2 Update the nearest `AGENTS.md` row for each touched file (`See change: align-ui-with-theme-tokens`)

## 3b. Copy (D9)

- [ ] 3b.1 Replace the 23 English strings in design.md D9 — both the `i18nT`/`t` fallback in code and the `packages/client/src/lib/i18n-en-source.json` value; keep every i18n key, Hungarian and Chinese values untouched
- [ ] 3b.2 `ui-contract.md`: add a "Terminology" row — "new session" / "start" / "restart", never "spawn" in user-facing copy

## 4. Test infra

- [ ] 4.1 `tests/e2e/helpers/computed-contrast.ts`: extract the in-page computed-contrast routine from `mockups/ux-probe.cjs` (canvas colour resolve + ancestor composite)
- [ ] 4.2 Harness seeding: goal with 2 verdicts + 1 linked session; automation with a missing file path; select/confirm prompt fixtures

## 5. Scenario tests (folded from test-plan.md)

- [ ] 5.1 L1 vitest `packages/client/src/lib/__tests__/tint-tokens.test.ts`: tints: severity values unchanged (see packages/client/src/lib/__tests__/theme-body-text-contrast.test.ts) — input: `index.css` before (git `HEAD~`) and after; every theme × light/dark · trigger: resolve `--severity-{success,warning,info,error}-{bg,fg,border}` via the theme-var resolver used by `theme-body-text-contrast.test.ts` · observable: resolved strings identical (test-plan #E1)
- [ ] 5.2 L1 vitest `packages/client/src/lib/__tests__/tint-tokens.test.ts`: tints: contrast gate (see packages/client/src/lib/__tests__/theme-body-text-contrast.test.ts) — input: every theme × light/dark; hues green/orange/blue/purple/red · trigger: composite `--tint-<hue>-fg` over `--tint-<hue>-bg` · observable: ≥ 4.5:1, or the same documented per-theme exception list as the severity gate (test-plan #E2)
- [ ] 5.3 L1 vitest `packages/client/src/lib/__tests__/aligned-surfaces-no-literals.test.ts`: no palette literals on surfaces (see packages/client/src/lib/__tests__/theme-body-text-contrast.test.ts) — input: the 8 surface files · trigger: regex scan of `className`/`style` for `(text\|bg\|border)-(green\|orange\|blue\|yellow\|indigo\|red\|amber\|purple\|emerald\|sky)-\d`, `#[0-9a-fA-F]{3,8}`, `rgba(` · observable: 0 matches (test-plan #E3)
- [ ] 5.4 L1 vitest `packages/client/src/components/session/__tests__/SessionCard-status-shape.test.tsx`: status colour on shape only (see packages/client/src/lib/__tests__/theme-body-text-contrast.test.ts) — input: `SessionCard` rendered in each status incl. resuming · trigger: RTL render, read computed class of status word and shape · observable: word uses `--text-secondary`; shape uses `--status-*`; no `--status-*` on text nodes (test-plan #E4)
- [ ] 5.5 L1 vitest `packages/client/src/lib/__tests__/aligned-surfaces-no-literals.test.ts`: text-muted only for decoration (see packages/client/src/lib/__tests__/theme-body-text-contrast.test.ts) — input: the 8 surface files · trigger: scan `--text-muted` uses · observable: every use is a `disabled:` variant or on an element with `aria-hidden="true"`; 0 other uses (test-plan #E5)
- [ ] 5.6 L1 vitest `packages/client/src/components/worktree/__tests__/WorktreeSpawnDialog-primary.test.tsx`: disabled primary keeps legible text (see packages/client/src/lib/__tests__/theme-body-text-contrast.test.ts) — input: worktree Create button with `canSubmit=false` · trigger: RTL render · observable: classes `disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)]` present (test-plan #E6)
- [ ] 5.7 L3 Playwright `tests/e2e/ui-token-alignment.spec.ts`: spawn tray contrast (see tests/e2e/severity-contrast.spec.ts) — input: folder card of a pinned repo · trigger: dark and light; computed contrast on "New Session" / "New Worktree" · observable: each ≥ 4.5:1; tokens `--tint-green-*` / `--tint-orange-*` in computed style chain (test-plan #F1)
- [ ] 5.8 L3 Playwright `tests/e2e/ui-token-alignment.spec.ts`: session card chips (see tests/e2e/severity-contrast.spec.ts) — input: card with Fork / +Session / Worktree / Archive anyway chips and worktree badge · trigger: dark and light, 375 and 1280 · observable: contrast ≥ 4.5:1; text ≥ 12 px (badge ≥ 11 px); targets ≥ 44×44 at 375, ≥ 32 px tall at 1280 (test-plan #F2)
- [ ] 5.9 L3 Playwright `tests/e2e/ui-token-alignment.spec.ts`: worktree dialog (see tests/e2e/severity-contrast.spec.ts) — input: dialog opened from tray, fork mode with a colliding branch name · trigger: dark and light, 375 and 1280 · observable: headings ≥ 4.5:1 and ≥ 12 px; source toggle ≥ 44×44 / ≥ 32 px; collision block `--severity-warning-*` ≥ 4.5:1; Create button `--accent-solid` + white ≥ 4.5:1 (test-plan #F3)
- [ ] 5.10 L3 Playwright `tests/e2e/ui-token-alignment.spec.ts`: goal detail controls (see tests/e2e/severity-contrast.spec.ts) — input: seeded goal with 2 verdicts, 1 linked session · trigger: dark and light, 375; Tab through loop controls · observable: every control ≥ 44×44 at 375; focus ring visible on each; delete `--tint-red-*`, + New session `--tint-purple-*`, contrast ≥ 4.5:1 (test-plan #F4)
- [ ] 5.11 L3 Playwright `tests/e2e/ui-token-alignment.spec.ts`: select / confirm prompt (see tests/e2e/severity-contrast.spec.ts) — input: select-prompt fixture (2 options) and confirm fixture · trigger: dark and light, 375 · observable: options ≥ 44 px tall, ≥ 12 px, ≥ 4.5:1 (test-plan #F5)
- [ ] 5.12 L3 Playwright `tests/e2e/ui-token-alignment.spec.ts`: automation dialog help (see tests/e2e/severity-contrast.spec.ts) — input: automation dialog opened on an existing automation with missing file path · trigger: dark and light · observable: subtitle, next-run, locked-name and file-path help ≥ 12 px, `--text-secondary` ≥ 4.5:1; error text `--severity-error-fg` ≥ 4.5:1; enabled badge `--tint-green-*` (test-plan #F6)
- [ ] 5.13 L3 Playwright `tests/e2e/ui-token-alignment.spec.ts`: axe on changed surfaces (see tests/e2e/severity-contrast.spec.ts) — input: F1–F6 surfaces · trigger: axe `wcag2a/2aa/21aa/22aa` scoped to each surface, dark and light · observable: 0 violations (test-plan #F7)
- [ ] 5.14 L3 Playwright `tests/e2e/ui-token-alignment.spec.ts`: keyboard focus (see tests/e2e/severity-contrast.spec.ts) — input: every button on F1–F6 surfaces · trigger: focus each via Tab · observable: computed outline or ring present on each (test-plan #F8)
- [ ] 5.15 L3 Playwright `tests/e2e/ui-token-alignment.spec.ts`: no layout regression (see tests/e2e/severity-contrast.spec.ts) — input: sidebar at 320 px min width, folder card with 3 sessions · trigger: render · observable: no horizontal overflow; chip row wraps instead of clipping (test-plan #F9)
- [ ] 5.16 MANUAL: visual match to mockup — input: `mockups/index.html` A1–A6 vs rebuilt live surfaces · trigger: side-by-side screenshots dark + light · observable: reviewer confirms same recipe (hue, weight, radius, spacing); differences listed (test-plan #F10)
- [ ] 5.17 L3 Playwright `tests/e2e/ui-token-alignment.spec.ts`: error text readable (see tests/e2e/severity-contrast.spec.ts) — input: worktree dialog `branch_exists` error; automation missing-file error · trigger: dark and light · observable: error text uses `--severity-error-fg`, ≥ 12 px, ≥ 4.5:1 (test-plan #X1)

- [ ] 5.18 L1 vitest `packages/client/src/lib/__tests__/ui-copy-no-spawn.test.ts`: copy: no spawn wording (see packages/client/src/lib/__tests__/theme-body-text-contrast.test.ts) — input: i18n-en-source.json values + every i18nT/t English fallback in packages/*/src (non-test) · trigger: regex \b(re)?spawn(s|ed|ing)?\b case-insensitive · observable: 0 matches (test-plan #E7)
- [ ] 5.19 L1 vitest `packages/client/src/lib/__tests__/ui-copy-no-spawn.test.ts`: copy: keys + translations stable (see same file) — input: key sets of en-source, i18n-hu.ts, zh table, i18n-legacy-aliases.ts before/after · trigger: diff · observable: no key removed or renamed; hu/zh values byte-identical (test-plan #E8)
- [ ] 5.20 L1 vitest `packages/client/src/components/worktree/__tests__/WorktreeSpawnDialog-primary.test.tsx`: copy: exact labels (see same file) — input: D9 rows git.spawnIntoThatWorktree, autoRespawnLabel, fieldCount, session.spawnASessionAttachedToThis · trigger: RTL render of collision block, goal settings, automation dialog, OpenSpec row · observable: visible text equals D9 "new" column (test-plan #E9)

## 6. Verification

- [ ] 6.1 `npm test` green
- [ ] 6.2 `npm run test:e2e -- ui-token-alignment` green against the docker harness
- [ ] 6.3 Re-run `mockups/ux-probe.cjs` on the live folder card after `npm run build` + restart: C/S/T checks pass for the changed surfaces (record score in `mockups/ux-test.md`)
- [ ] 6.4 `openspec validate align-ui-with-theme-tokens --strict`
