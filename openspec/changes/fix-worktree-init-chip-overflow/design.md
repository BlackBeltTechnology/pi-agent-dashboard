# Design

## Context

Base: the chip as left by `fix-folder-card-pill-contrast`, in worktree `.worktrees/os-fix-folder-card-pill-contrast` (commit `022b87c19`; chip lines `:57`, `:84`, `:94`, `:115`, `:121`), not `develop`. This change builds on that code after it merges.

Render path:
- `SessionList` folder group → `FolderActionBanner`: the banner is `flex w-full` + `SEVERITY_CLASS` (`packages/client/src/components/folder/FolderActionBanner.tsx:152` on develop), and its child is `flex-1 min-w-0` (`:175`).
- → `WorktreeInitButton`, which returns the chip while a run exists (`packages/client/src/components/worktree/WorktreeInitButton.tsx:134`). That is the chip's only call site.
- → `WorktreeInitChip`.

`computeBannerRung` maps running and done to `info`, and failed to `error` (`FolderActionBanner.tsx:58,~71`).

The sibling's chip still has the overflow:
- running root `inline-flex flex-col min-w-[240px] max-w-[420px]`;
- ghost `whitespace-nowrap … max-w-[420px]`;
- failed root `inline-flex flex-col gap-1 max-w-[460px]`, with the failure code line `break-words`;
- `LogDisclosure` `max-w-[460px]`.

Contract anchors:
- `openspec/specs/message-severity-tokens/spec.md`: relative gate (severity fg on own bg ≥ 3:1; tokyo-night light info ≥ 2.5:1); "Severity styles the chrome, not multi-line body content" for contained surfaces.
- `ui-contract.md:248-249` a11y rule 6: "Quiet body copy that must survive every palette takes `--text-secondary`".
- `ui-contract.md:248-256` a11y rule 7: a disclosure summary inherits its callout's fg and is underlined.
- `ui-contract.md:122`: `tap-target`.
- `openspec/specs/folder-action-banner/spec.md` "Banner is accessible": 44 px at mobile width.

## Goals / Non-Goals

**Goals:**
- No horizontal overflow of the chip past the banner. Measured on the real component in the E2E at a 390 px mobile viewport and at the harness's default desktop viewport.
- Secondary single-line run text ≥ 4.5:1 in all 18 theme×mode combos.

**Non-Goals:**
- Re-deciding the sibling's choices. The label, glyphs, spinner, bar, Retry and toggle colour keep inheriting. The `done` line stays on the info rung. The MDI icons stay. The log body stays `--text-secondary` on `--bg-code`.
- `WorktreeInitStack`.

## Decisions

### D1. Block-level root `flex flex-col w-full`, caps kept
A block-level flex root takes the banner's width through `w-full`, and `max-w-[420px]` / `[460px]` still cap it on wide cards. The root is a block child of the banner's `flex-1 min-w-0` wrapper (`FolderActionBanner.tsx:175`), not a flex item, so `min-w-0` would be a no-op and is not added. Intended visual consequence: the progress bar and status block always span the banner width (capped), instead of shrink-wrapping. In a column flex, the ghost's width comes from cross-axis stretch to the root's width. Its own `overflow-hidden text-ellipsis whitespace-nowrap` then truncates. `min-w-[240px]` is removed.

The failure code line and `<pre>` use `[overflow-wrap:anywhere]` instead of `break-words`. Only `anywhere` lets an unbroken token shrink the min-content contribution.

- Alternative: keep `inline-flex` and add `max-w-full`. Not measured. `w-full` states "fill the banner" directly and is what the board measured at 0 px.
- Alternative: a container query. Rejected as too much for the bug.

### D2. Secondary single-line text → `--text-secondary`; chrome keeps inheriting
Sweep from the `themes.ts` tokens through the `index.css` `color-mix` recipes. A cross-model reviewer reproduced it within ±0.03.

| Pair, 18 combos | Result |
|---|---|
| `--severity-info-fg` on info-bg | 2.71 (tokyo-night light), 3.80 (catppuccin light), else ≥ 4.8 |
| `--severity-error-fg` on error-bg | 3.21 (tokyo-night light), 4.27 (rose-pine light), 4.41 (catppuccin light), else ≥ 4.6 |
| `--text-secondary` on info-bg and error-bg | min ≈ 5.3 |

Grounding: `ui-contract.md` a11y rule 6, "quiet body copy that must survive every palette takes `--text-secondary`". (`message-severity-tokens` "icon + message" does not apply: it governs surfaces with no container fill or border, and this banner has both.)
- The status label ("Initializing…", "Initialized", "Init failed") and glyphs are severity chrome and keep the fg, under the relative gate.
- The elapsed time (running and done), last-line preview and failure message line are quiet body copy and take `--text-secondary`.
- The "View log" toggle and Retry are controls and keep inheriting, per a11y rule 7 and the sibling.

This is the only colour this change moves. The label, Retry and toggle stay at the relative-gate values: info 2.71 (tokyo-night light), 3.80 (catppuccin light); error 3.21 / 4.27 / 4.41 (tokyo-night / rose-pine / catppuccin light).
- Alternative: keep everything inheriting (the sibling's position). Rejected: the bulk text stays sub-AA in three light palettes.
- Alternative: `--text-tertiary`. Rejected: ≈ 4.4 in nord dark.

### D3. Interactive floor and target
- The "View log" `<summary>` goes 11 → 12 px and gains an underline (rule 7).
- Retry gains `tap-target` (`min-height 44px`, 32 px from `sm`).

### D4. The E2E drives the real component through stubs
- Pin one fixture directory that S14/S15 do not use and that has no ended sessions (`/fixtures/kb-parent`), so its banner renders (pinned groups render without sessions; `isStub` needs ended history, `SessionList.tsx:1980`). Assert `folder-banner-running-<cwd>` / `folder-banner-failed-<cwd>` visible before measuring.
- One cwd at a time: `WorktreeInitStack` mounts at two or more runs (`WorktreeInitStack.tsx:37`, a fixed overlay) and could cover the banner at 390 px.
- Stub `GET /api/git/worktree/active-inits` with that cwd at `phase:"running"`, as in `forceConcurrentInitStack` (`tests/e2e/mobile-viewport-bound.spec.ts:87`). Running seeds subscribe by cwd (`worktree-init-store.ts:180-183`); failed seeds do not, so the failure case also starts from a running seed.
- Inject shell-WebSocket frames with `installFrameInjector` (`mobile-viewport-bound.spec.ts:117`). It and `forceConcurrentInitStack` are not exported: extract both to `tests/e2e/helpers/` (re-import in `mobile-viewport-bound.spec.ts`) rather than duplicate. Protocol: `packages/shared/src/browser-protocol.ts:923-950`.
  - Progress: `{type:"worktree_init_progress", requestId:"", cwd, line}`, where `line` holds a >200-char line and an unbroken >120-char path. The store derives `lastLine` and `logTail` (`worktree-init-store.ts:89-97`).
  - Failure: `{type:"worktree_init_failed", requestId:"", cwd, code:"script_nonzero_exit", message, stderr}`. `code` stays a real protocol classifier (`browser-protocol.ts:941-950`); the long unbroken token goes in `message` and `stderr`.
- Overflow: `overflowFailures(banner)` (`tests/e2e/helpers/computed-contrast.ts:198`) is empty for the running banner (log open) and the failed banner (log open), at a 390 px viewport and the default desktop viewport; Retry's box lies inside the banner's box; the ghost is ellipsized (`scrollWidth > clientWidth`).
- Open each banner's `<details>` before measuring its `<pre>`. Closed content has no layout, and `measureText` skips `offsetParent === null` (`tests/e2e/helpers/computed-contrast.ts:84`).
- Contrast is split by role:
  - secondary text (new testids `worktree-init-elapsed`, `worktree-init-message`, plus the existing `worktree-init-ghost`) ≥ 4.5:1, swept over 18 combos with `applyTheme` (exemplar `tests/e2e/severity-contrast.spec.ts:57`);
  - severity-fg chrome is left to the sibling's and `message-severity-tokens`' gates;
  - the `<pre>` and the `<summary>` 12 px are checked with direct computed-style reads, because `measureText` omits `pre` (`:82`) and treats only `button, label, a` as interactive (`:105`).

Why not the hook fixtures:
- `sample-hook-ok` is one-shot per container: S14 consumes it (`tests/e2e/worktree-init-feedback.spec.ts:65`).
- Its 5 s window races the measurement.
- The fixture content is fixed and short.

## Risks / Trade-offs

- [Merge conflict with the sibling: same file, same requirements] → Sequenced dependency. Build in a worktree branched after the sibling merges, and re-diff the MODIFIED deltas against the archived spec before archiving this change.
- [Severity-fg chrome stays sub-AA in three light palettes] → Unchanged from the sibling, and inside the `message-severity-tokens` relative gate. This change moves only the message text.
- [jsdom cannot measure layout] → Unit tests are structural guards on the class contract only. The evidence comes from the E2E (D4).
- [Width coverage] → The E2E measures at a 390 px viewport and the default desktop viewport. The fit claim rests on D1's mechanism, not on a full width sweep. With `min-w-[240px]` gone, the non-wrapping status row (label + elapsed) sets the floor; the narrowest card measured on the board (260 px, 212 px banner content) fits it.

## Migration Plan

Client-only. Steps: `npm run build`, then restart. Rollback: revert the files listed in proposal.md under Impact.
