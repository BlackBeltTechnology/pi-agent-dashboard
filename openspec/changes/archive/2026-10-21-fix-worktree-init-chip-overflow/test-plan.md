# Test Plan — fix-worktree-init-chip-overflow

Stage: design   Generated: 2026-10-21

No clarifications outstanding: the hard gate passed, and every Triple below is concrete.

Harness facts used:
- **Chip base.** The chip base is the sibling `fix-folder-card-pill-contrast` (merged first, per tasks 0.1).
- **L3 stubs.**
  - `GET /api/git/worktree/active-inits` is stubbed per `forceConcurrentInitStack` (`tests/e2e/mobile-viewport-bound.spec.ts:87`).
  - Shell-WebSocket frames are injected with `installFrameInjector` (`:117`). Both helpers are extracted to `tests/e2e/helpers/`.
  - One cwd at a time, so `WorktreeInitStack` (≥ 2 runs) never mounts.
- **Fixture.** The pinned fixture is `/fixtures/kb-parent`. No e2e spec spawns sessions there, so it has no ended history and does not become a stub (`SessionList.tsx:1980`); S14/S15 don't use it. With a run in the store, `computeBannerRung` yields `running` / `failed` regardless of the hook. Every L3 row asserts the banner visible before measuring.
- **Frame shapes** (`packages/shared/src/browser-protocol.ts:923-950`):
  - progress: `{type:"worktree_init_progress", requestId:"", cwd, line}`;
  - failure: `{type:"worktree_init_failed", requestId:"", cwd, code:"script_nonzero_exit", message, stderr}`.
- **Long content.** `LONG_LINE` = 220 chars of words. `LONG_PATH` = a 150-char unbroken absolute path.
- **Contrast.** Rendered contrast uses `tests/e2e/helpers/computed-contrast.ts` (`overflowFailures`, `elementColors`, `contrastRatio`); palettes are switched with `applyTheme` (`tests/e2e/severity-contrast.spec.ts:57`). `measureText` omits `pre` and treats `<summary>` as non-interactive, so those elements are checked with direct computed-style reads.
- **L1 palette exemplar.** Palette resolution follows `packages/client/src/lib/__tests__/action-menu-tone-contrast.test.ts`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | worktree-init-feedback "Init feedback fits its banner"; design D1 | EP (layout contract) | L1 | automated | `WorktreeInitChip` running run `{lastLine: LONG_LINE, logTail: LONG_LINE+"\n"+LONG_PATH}` | render | `worktree-init-chip` class list ⊇ `flex flex-col w-full max-w-[420px]` and contains neither `inline-flex` nor `min-w-[240px]`; `worktree-init-ghost` ⊇ `whitespace-nowrap overflow-hidden text-ellipsis max-w-full` and lacks `max-w-[420px]`; `worktree-init-log` ⊇ `max-w-full`; its `<pre>` carries `[overflow-wrap:anywhere]` |
| E2 | "Init feedback fits its banner" (failed); design D1 | EP (layout contract) | L1 | automated | failed run `{code:"script_nonzero_exit", message: LONG_PATH, stderr: LONG_PATH}` + `onRetry` | render | `worktree-init-chip` ⊇ `flex flex-col gap-1 w-full max-w-[460px]`, no `inline-flex`; `worktree-init-message` carries `[overflow-wrap:anywhere]` and not `break-words`; `worktree-init-retry` present |
| E3 | folder-action-banner "Banner uses existing severity tokens…" (quiet body copy vs chrome); design D2 | decision-table (phase × element) | L1 | automated | three runs: running (`lastLine` set), done, failed (as E2) | render each | `--text-secondary` class on `worktree-init-elapsed` (running, done), `worktree-init-ghost`, `worktree-init-message`, and the `<pre>`; NO colour class (`text-[var(--…)]` or palette) on the status label span, `<summary>` or `worktree-init-retry` (they inherit); no `--text-muted`, no `--text-tertiary`, no `-400`/`-500` palette class anywhere |
| E4 | "Init feedback meets the type floor"; design D3 | BVA (11 / 12 px floors) | L1 | automated | running + failed runs | render | `<summary>` ⊇ `text-[12px] underline`; `worktree-init-retry` ⊇ `text-[12px] tap-target`; the `<pre>` and `worktree-init-message` ⊇ `text-[11px]`; no `text-[10.5px]` / `text-[10px]` / `text-[9px]` in the tree |
| E5 | folder-action-banner "Secondary run text meets AA in every theme" | BVA (floor 4.5) over 18 combos | L1 | automated | 18 palettes (9 themes × dark/light) resolved from `index.css` + `THEMES` (per exemplar) | resolve `--text-secondary` vs `--severity-info-bg` and vs `--severity-error-bg` | all 36 ratios ≥ 4.5 (sweep min ≈ 5.3); a failing cell names palette + severity + ratio |
| E6 | "Init feedback fits its banner" (narrow viewport) | BVA (viewport 320 / 390 / default desktop) | L3 | automated | pinned `/fixtures/kb-parent`; active-inits stub `{cwd, phase:"running", startedAt: now}`; progress frame `line = LONG_LINE+"\n"+LONG_PATH` | at each viewport width: wait for `folder-banner-running-<cwd>`, inject frame, open `worktree-init-log` | `overflowFailures(banner)` is empty; ghost `scrollWidth > clientWidth` (ellipsized); `<pre>` bounding-box right ≤ banner right + 0.5 px |
| E7 | "Failure with a long unbroken summary fits" | BVA (token longer than banner) | L3 | automated | same pin + running stub; then failed frame `{code:"script_nonzero_exit", message: LONG_PATH, stderr: LONG_PATH}` | at viewports 320 and 390: wait for `folder-banner-failed-<cwd>`, open `worktree-init-log` | `overflowFailures(banner)` empty; `worktree-init-message` height > one line-height (wrapped); `worktree-init-retry` bounding box lies inside the banner's box |
| E8 | folder-action-banner "Banner is accessible" (44 px target); design D3 | BVA (viewport `sm` breakpoint) | L3 | automated | failed banner as E7 | measure `worktree-init-retry` at 390 px and at the default desktop viewport | height ≥ 44 px at 390; ≥ 32 px at desktop |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| Q1 | folder-action-banner "Secondary run text meets AA in every theme" (rendered) | decision-table (palette × element) | L3 | automated | running banner with `lastLine` (E6 setup) and failed banner (E7 setup), in base light, tokyo-night light and catppuccin light (the palettes where inherited fg is sub-AA) | `applyTheme` → re-stub → re-inject → measure | computed `color` of `worktree-init-elapsed`, `worktree-init-ghost`, `worktree-init-message` equals the resolved `--text-secondary` (probe element), and `contrastRatio` against the composited banner bg ≥ 4.5; the opened `<pre>` color = resolved `--text-secondary`, bg = resolved `--bg-code`; `<summary>` computed `font-size` = 12px, `text-decoration-line` includes `underline`, and `color` equals the banner region's `color` |
| Q2 | sibling #F3 regression (preview colour contract changed by this change) | state-convergence | L3 | automated | the existing #F3 block in `tests/e2e/worktree-init-feedback.spec.ts` (~L106-112): `/fixtures/sample-hook-ok`, base light | the existing run flow | the ghost colour assertion now expects the resolved `--text-secondary` (probe), not the region `color`; the rest of #F3 (text ≥ 4.5, spinner ≥ 3:1, converge and clear) unchanged and green |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | design D1 visual consequence (full-width bar) | exploratory | — | manual-only | built app, isolated env, a real slow init (e.g. Maven `go-offline`) on a narrow sidebar card | watch running → failed/done in base dark and base light | chip never paints past the card; the full-width progress bar and the `--text-secondary` body copy read as intended against the mockup B′ column |

---

## New infra needed

None. The two exported helpers are extracted from an existing spec, not newly written.
