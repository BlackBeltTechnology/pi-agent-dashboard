# Proposal

## Why

The worktree-init chip spills past the right edge of its session-list folder card during a run. Repro: a Maven `go-offline` init on a ~300 px sidebar card. The status line, progress bar and "View log" panel paint over the card border and into the next column.

Root cause, in `WorktreeInitChip.tsx`. The in-flight sibling change `fix-folder-card-pill-contrast` leaves all of these unchanged:
- The last-line preview is `whitespace-nowrap` with its own `max-w-[420px]`.
- The chip root is `inline-flex` (shrink-to-fit) with `min-w-[240px] max-w-[420px]`. The nowrap preview's width therefore drives the root to its 420 px cap, whatever the banner offers. `min-w-[240px]` is a second floor.
- The failed root is `inline-flex … max-w-[460px]`. A long unbroken failure line or path pushes past it.

Overflow measured on the mockup board, a replica with the as-built classes mirrored. The reference edge is the banner's content box (card width − 48 px). The running chip lands exactly at its 420 px cap.

| card width | 260 px | 340 px | 460 px |
|---|---|---|---|
| running / failed overflow | +208 / +278 px | +128 / +198 px | +8 / +78 px |

Contrast in the same banner:
- The sibling paints all single-line run text in the inherited banner `--severity-*-fg`: elapsed time, last-line preview and failure code line.
- That passes the `message-severity-tokens` relative gate, but measures 2.71–4.41:1 in catppuccin light, tokyo-night light and rose-pine light.
- `--text-secondary` on the same banner backgrounds measures ≥ 5.3:1 in all 18 theme×mode combos.

## What Changes

**Depends on `fix-folder-card-pill-contrast`** (branch `os/fix-folder-card-pill-contrast`, implementation commit `022b87c19`). Sequencing:
- This change is built and archived after the sibling merges.
- Its MODIFIED deltas are authored against the sibling's post-archive requirement text.
- If the sibling's text changes before it archives, rebase these deltas.

Changes:
- **Fit the banner.**
  - running root `inline-flex flex-col min-w-[240px] max-w-[420px]` → `flex flex-col w-full max-w-[420px]`;
  - failed root `inline-flex flex-col … max-w-[460px]` → `flex flex-col w-full … max-w-[460px]`;
  - last-line preview `max-w-[420px]` → `max-w-full`, keeping `whitespace-nowrap overflow-hidden text-ellipsis`;
  - log `<details>` `max-w-[460px]` → `max-w-full`;
  - log `<pre>` and failure code line gain `[overflow-wrap:anywhere]`, replacing `break-words`, which does not reduce min-content;
  - the `done` line stays inline (short fixed text).
- **Quiet body copy to `--text-secondary`** (`ui-contract.md` a11y rule 6). Elapsed time (running and done), last-line preview and failure message line paint `--text-secondary`. The status label, glyphs, spinner, bar, Retry and the "View log" toggle keep inheriting the banner fg (sibling), so they keep its relative-gate values in three light palettes. New testids `worktree-init-elapsed` and `worktree-init-message` (additive).
- **"View log" toggle** 11 → 12 px (interactive floor) and underlined (`ui-contract.md` a11y rule 7).
- **Retry** gains `tap-target` (44 px below `sm`), per `folder-action-banner` "Banner is accessible".
- **Stale notes.** The `SessionList.tsx` folder-row comment ("min-w ~240px … wraps") and the `WorktreeInitChip.tsx` header ("Colour-free …").
- Mockup: mockups/worktree-init-chip-overflow (in this change).

Out of scope:
- `FolderActionBanner` layout, rungs and the compact chip;
- `WorktreeInitStack`;
- the store, websocket events, server and fixtures.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `worktree-init-feedback`:
  - ADDED: "Init feedback fits its banner";
  - ADDED: "Init feedback meets the type floor";
  - MODIFIED: "Feedback replaces raw terminal output" and "Init progress and failure render in the tier-0 banner" (the preview becomes `--text-secondary`).
- `folder-action-banner`: MODIFIED "Banner uses existing severity tokens and distinct glyphs":
  - secondary single-line run text paints `--text-secondary`, not the inherited fg;
  - the "View log" toggle is 12 px and underlined.

## Impact

Code:
- `packages/client/src/components/worktree/WorktreeInitChip.tsx` (classes);
- `packages/client/src/components/session/SessionList.tsx` (comment).

Tests:
- `packages/client/src/components/worktree/__tests__/WorktreeInitChip.test.tsx`;
- a new scenario in `tests/e2e/worktree-init-feedback.spec.ts` (route and WebSocket-frame stubs);
- `installFrameInjector` / `forceConcurrentInitStack` extracted from `tests/e2e/mobile-viewport-bound.spec.ts` to `tests/e2e/helpers/`.

Mockup: `openspec/changes/fix-worktree-init-chip-overflow/mockups/worktree-init-chip-overflow/`.

Docs:
- `packages/client/src/components/worktree/WorktreeInitChip.tsx.AGENTS.md`;
- `packages/client/src/components/worktree/AGENTS.md`.

No API, protocol, store, server, token or fixture change. Client rebuild only. Rollback: revert those files.

Conflict surface with the sibling: the same component, plus the same two `worktree-init-feedback` requirements and one `folder-action-banner` requirement. Resolved by sequencing (above).

## Discipline Skills

- `review-code`: non-trivial UI change; run it before commit, once the tests pass.
- No security, performance, observability or irreversible-step triggers: the change is presentational classes and tests only.
