# Tasks

## 0. Preconditions

- [ ] 0.1 Confirm `fix-folder-card-pill-contrast` is merged to `develop` and archived. Branch this change's worktree from that commit. Re-diff this change's MODIFIED deltas (`specs/worktree-init-feedback/spec.md`, `specs/folder-action-banner/spec.md`) against the archived `openspec/specs/` text and rebase any wording drift. Verify: `rg -n mdiReplay packages/client/src/components/worktree/WorktreeInitChip.tsx` hits (sibling base present); `rg -n "min-w-\[240px\]" packages/client/src/components/worktree/WorktreeInitChip.tsx` hits (overflow still present); every class string and line reference quoted in `design.md` Context is re-checked; `openspec validate fix-worktree-init-chip-overflow` passes.

## 1. Chip fits its banner (D1)

- [ ] 1.1 L1 test, RED first. Exemplar: `packages/client/src/components/__tests__/WorktreeInitButton.test.tsx`; new file `packages/client/src/components/worktree/__tests__/WorktreeInitChip.test.tsx`. Verify: the new test fails on the sibling base.
  - Input: running run `{lastLine: LONG_LINE, logTail: LONG_LINE+"\n"+LONG_PATH}`. Trigger: render.
  - Expected: chip ⊇ `flex flex-col w-full max-w-[420px]`, with no `inline-flex` and no `min-w-[240px]`; ghost ⊇ `whitespace-nowrap overflow-hidden text-ellipsis max-w-full`, without `max-w-[420px]`; `worktree-init-log` ⊇ `max-w-full`; `<pre>` has `[overflow-wrap:anywhere]` (test-plan #E1).
- [ ] 1.2 L1 test, RED first, same file and exemplar. Verify: fails on the sibling base.
  - Input: failed run `{code:"script_nonzero_exit", message: LONG_PATH, stderr: LONG_PATH}` + `onRetry`. Trigger: render.
  - Expected: chip ⊇ `flex flex-col gap-1 w-full max-w-[460px]`, with no `inline-flex`; `worktree-init-message` has `[overflow-wrap:anywhere]` and not `break-words`; `worktree-init-retry` present (test-plan #E2).
- [ ] 1.3 Extract `installFrameInjector` and `forceConcurrentInitStack` from `tests/e2e/mobile-viewport-bound.spec.ts` into `tests/e2e/helpers/` (exported, re-exported from `helpers/index.ts`), and re-import them in `mobile-viewport-bound.spec.ts`. Verify: `npx tsc --noEmit -p tests/e2e` is clean and `mobile-viewport-bound.spec.ts` stays green on the harness (skill `run-dashboard-e2e-local-changes`).
- [ ] 1.4 L3 test, RED first. Exemplar: `tests/e2e/mobile-viewport-bound.spec.ts` (stub and frame helpers) + `tests/e2e/worktree-init-feedback.spec.ts` (`folderGroup`, pinning). New scenario in `worktree-init-feedback.spec.ts`. Verify: fails on the sibling base, with overflow reported.
  - Input: pinned `/fixtures/kb-parent`; active-inits stub `{cwd, phase:"running"}`; progress frame `line = LONG_LINE+"\n"+LONG_PATH`.
  - Trigger: at viewports 320, 390 and the default desktop, wait for `folder-banner-running-<cwd>`, inject the frame, open `worktree-init-log`.
  - Expected: `overflowFailures(banner)` empty; ghost `scrollWidth > clientWidth`; `<pre>` right ≤ banner right + 0.5 px (test-plan #E6).
- [ ] 1.5 L3 test, RED first, same exemplars and spec file. Verify: fails on the sibling base.
  - Input: same pin and running stub, then the failed frame `{code:"script_nonzero_exit", message: LONG_PATH, stderr: LONG_PATH}`.
  - Trigger: at 320 and 390, wait for `folder-banner-failed-<cwd>`, open `worktree-init-log`.
  - Expected: `overflowFailures(banner)` empty; `worktree-init-message` wraps (height > one line-height); `worktree-init-retry` box inside the banner box (test-plan #E7).
- [ ] 1.6 In `packages/client/src/components/worktree/WorktreeInitChip.tsx`:
  - running root → `flex flex-col w-full max-w-[420px]`;
  - failed root → `flex flex-col gap-1 w-full max-w-[460px]`;
  - ghost `max-w-[420px]` → `max-w-full`, keeping `whitespace-nowrap overflow-hidden text-ellipsis`;
  - `LogDisclosure` `<details>` → `max-w-full`; `<pre>` + `[overflow-wrap:anywhere]`;
  - failure message line `break-words` → `[overflow-wrap:anywhere]`, plus `data-testid="worktree-init-message"`;
  - elapsed spans (running and done) get `data-testid="worktree-init-elapsed"`;
  - the done line's layout is unchanged.

  Verify: 1.1, 1.2, 1.4 and 1.5 are green, and `packages/client/src/components/__tests__/WorktreeInitButton.test.tsx` stays green.

## 2. Quiet body copy, toggle, target (D2–D3)

- [ ] 2.1 L1 test, RED first, in `WorktreeInitChip.test.tsx` (exemplar as 1.1). Verify: fails before 2.5.
  - Input: three runs: running (`lastLine`), done, failed (as 1.2). Trigger: render each.
  - Expected: `text-[var(--text-secondary)]` on `worktree-init-elapsed` (running and done), `worktree-init-ghost`, `worktree-init-message` and the `<pre>`; no colour class on the status label, `<summary>` or `worktree-init-retry`; no `--text-muted`, `--text-tertiary` or `-400`/`-500` palette class (test-plan #E3).
- [ ] 2.2 L1 test, RED first, same file. Verify: fails before 2.5.
  - Input: running + failed runs. Trigger: render.
  - Expected: `<summary>` ⊇ `text-[12px] underline`; `worktree-init-retry` ⊇ `text-[12px] tap-target`; `<pre>` and `worktree-init-message` ⊇ `text-[11px]`; no `text-[10.5px]` / `text-[10px]` / `text-[9px]` (test-plan #E4).
- [ ] 2.3 L1 test. Exemplar: `packages/client/src/lib/__tests__/action-menu-tone-contrast.test.ts`; new `packages/client/src/lib/__tests__/worktree-init-body-copy-contrast.test.ts`. Verify: green, and setting the floor to 6.0 makes it fail with a named cell.
  - Input: the 18 palettes resolved from `index.css` + `THEMES`.
  - Trigger: resolve `--text-secondary` vs `--severity-info-bg` and vs `--severity-error-bg`.
  - Expected: all 36 ratios ≥ 4.5; a failure names palette + severity + ratio (test-plan #E5).
- [ ] 2.4 L3 tests, RED first, in `tests/e2e/worktree-init-feedback.spec.ts`. Exemplars: `tests/e2e/severity-contrast.spec.ts` (`applyTheme`) and the 1.4 stub flow. Verify: #E8 and #Q1 fail before 2.5; #Q2 fails after 2.5 until updated, then passes.
  - **#E8.** Input: failed banner as 1.5. Trigger: measure `worktree-init-retry`. Expected: height ≥ 44 px at 390 px; ≥ 32 px at default desktop.
  - **#Q1.** Input: running + failed banners in base light, tokyo-night light and catppuccin light. Trigger: `applyTheme` → re-stub → re-inject → measure. Expected:
    - `worktree-init-elapsed` / `-ghost` / `-message` computed `color` = resolved `--text-secondary` (probe element), with `contrastRatio` ≥ 4.5 against the composited banner bg;
    - opened `<pre>` color = `--text-secondary` on bg = `--bg-code`;
    - `<summary>` `font-size` 12px, `text-decoration-line` ⊇ `underline`, `color` = banner region `color`.
  - **#Q2.** Update the existing #F3 block (~L106-112): the ghost colour now equals the resolved `--text-secondary`, not the region colour. The rest of #F3 is unchanged.
- [ ] 2.5 In `WorktreeInitChip.tsx`:
  - `worktree-init-elapsed` (running and done), ghost, and `worktree-init-message` → `text-[var(--text-secondary)]`;
  - `<pre>` and `worktree-init-message` at `text-[11px]`;
  - `LogDisclosure` `<summary>` → `text-[12px] underline`, still inheriting the colour;
  - Retry + `tap-target`.

  Nothing else changes colour. Verify: 2.1, 2.2 and 2.4 are green; `node scripts/theme-token-guard.mjs` reports no new violation; `npm run quality:changed` is clean (it runs `biome check --write`, so formatting edits are expected).
- [ ] 2.6 Update stale comments. `packages/client/src/components/session/SessionList.tsx` (~L2275: "min-w ~240px … wraps to its own line") → the chip fills the banner and is capped. The `WorktreeInitChip.tsx` header ("Colour-free …") → inherited chrome + `--text-secondary` body copy; add `See change: fix-worktree-init-chip-overflow`. Verify: `rg -n "min-w ~240px" packages/client/src` returns nothing, and `rg -n fix-worktree-init-chip-overflow packages/client/src/components/worktree/WorktreeInitChip.tsx` hits.
- [ ] 2.7 Update `packages/client/src/components/worktree/WorktreeInitChip.tsx.AGENTS.md` (fits-banner contract; `--text-secondary` body copy; toggle 12 px underlined; Retry `tap-target`; new testids `worktree-init-elapsed` and `worktree-init-message`; `See change: fix-worktree-init-chip-overflow`) and its row in `packages/client/src/components/worktree/AGENTS.md`. Also add the new helper file's row in `tests/e2e/helpers/` AGENTS.md if that directory has one. Verify: `rg fix-worktree-init-chip-overflow packages/client/src/components/worktree/` hits both files.

## 3. Verification

- [ ] 3.1 Full suite green (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then grep the summary). `npm run build` succeeds. The full `tests/e2e/worktree-init-feedback.spec.ts` (S14, S15, #F3 and the new scenarios) is green on the harness.
- [ ] 3.2 `review-code` pass on the diff, with no blocking findings.
- [ ] 3.3 Manual check (test-plan: manual-only, #M1). In the built app in an isolated env, run a real slow init (e.g. Maven `go-offline`) on a narrow sidebar card in base dark and base light. Expected: the chip never paints past the card, and the full-width bar and the `--text-secondary` body copy read as the mockup B′ column.
