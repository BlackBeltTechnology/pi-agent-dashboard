## 1. Shared primitives (TDD-first, no call-site changes yet)

- [x] 1.1 Write `LogBlock` component tests first: renders label + mono body; `collapsible` closed-by-default then expands; `preview` mode shows last N lines; copy control writes FULL text even when collapsed/preview; empty state renders nothing. Verify they fail.
- [x] 1.2 Implement `LogBlock` (client primitives dir) to pass 1.1: labelled header (label · copy · collapse/expand chevron), bounded `maxHeight` scroll, `preview` mode prop.
- [x] 1.3 Write `InlineMessage` component tests first: 3 severities resolve `--severity-{error,warning,info}-*` (no raw `red-500`/`amber-500`); `compact` one-line variant; `animate` top accent-bar sweep; action pills row; `mdiClose` dismiss fires ONLY `onDismiss` (no other side effect). Verify they fail.
- [x] 1.4 Implement `InlineMessage` to pass 1.3: severity accent bar + icon + title + sub/body + actions + dismiss, tokens only.
- [x] 1.5 Confirm `--severity-info-*` tokens exist in the theme layer; add them only if a surface needs `info` in v1 (none today — otherwise defer). Resolve design Q3.

## 2. Migrate inline surfaces onto the primitives

- [x] 2.1 Migrate `SpawnErrorBanner` to `InlineMessage`; fold `TimeoutBanner` into it via `severity="warning"`; render `stderr` through a collapsible `LogBlock`. Preserve `spawn-error-banner` / `spawn-timeout-banner` / `spawn-error-dismiss` test ids + i18n keys. Update its tests for the moved chrome.
- [x] 2.2 Migrate `SessionBanner` to `InlineMessage severity="error"` with the `animate` retry strip; keep Stop/Copy/dismiss + retry sub-line + show-more. Preserve `error-banner*` test ids. Update tests (satisfies `session-status-banner` MODIFIED: token-sourced surface).
- [x] 2.3 Migrate `MissingToolInlineError` to `InlineMessage variant="compact" severity="warning"`; keep the Install deep-link + `missing-tool-inline-error` test id.
- [x] 2.4 Migrate the `FlowAgentCard` code-node log preview to `LogBlock preview` with copy + expand (satisfies `flow-card-status` MODIFIED). Update flow-card tests for the new copy/expand affordances.
- [x] 2.5 Delete the now-orphaned bespoke styling + the `TimeoutBanner` component created by this change; run `code-simplification` pass over the diff.

## 3. Directory-card slot pills + grid

- [x] 3.1 Add a shared `SlotPill` presentational component (delivery per design Q1 — prefer export from `dashboard-plugin-runtime` so all four sections share one source without a new dep).
- [x] 3.2 In `SessionList.renderGroup`, wrap the `sidebar-folder-section` slot output + `FolderOpenSpecSection` in a 2-col grid container that collapses to 1-col at the mobile breakpoint; tolerate missing/nulled sections without broken cells.
- [x] 3.3 Migrate `FolderAutomationSection`, `FolderGoalsSection`, `FolderKbSection`, `FolderOpenSpecSection` render bodies to `SlotPill` (glyph + label + count + inline state + one primary action); keep each section's data hook, navigation, refresh, and create affordance. Move OpenSpec `Archive`/`Specs` to a thin sub-row.
- [x] 3.4 Bump slot micro-label tone from `--text-3` to `--text-2` (or ≥11px) to clear the AA contrast gap.

## 4. Watermark + detached spawn tray

- [x] 4.1 Add the `folder-3d.svg` watermark asset; render it in the card as an absolutely-positioned, `pointer-events:none`, `z-0` layer with the card `overflow:hidden` and a relative `z-1` content layer. Resolve design Q2 (center on pill-grid region).
- [x] 4.2 Move `FolderSpawnButtons` out of the bordered card into a sibling Create tray below it with a divider label; keep props, worktree gating, and `folder-spawn-*` test ids. Update `FolderSpawnButtons` tests for the new container.

## 5. Verify

- [x] 5.1 `npm test` green (tee→grep); fix regressions in migrated-surface + folder tests.
- [x] 5.2 `npm run build` + restart; verify in an ISOLATED env (frontend-mockup-loop-dashboard PROMOTE binding — temp HOME, non-8000 ports, openspec poll disabled). Confirm live `:8000` PID unchanged before/after.
- [x] 5.3 Visual/responsive check across all 4 themes × 3 breakpoints: slot pills, watermark legibility, detached tray, and all four inline surfaces (spawn error + stderr LogBlock, session error/retry, missing-tool, flow log preview). No overflow/clipping; touch targets ≥44px on mobile.
- [x] 5.4 `performance-optimization` pass: confirm the watermark (static) and the single-instance retry `animate` strip add no measurable paint/compositing regression per the card-pulse budget.
- [x] 5.5 `review-code` pass over the full diff before commit; run `npm run quality:changed`.

## 6. Manual / QA (tested later)

- [x] 6.1 Spawn a session that fails (bad pi path) and confirm the `SpawnErrorBanner` + stderr `LogBlock` render correctly in the directory card, with working copy/expand and dismiss.
- [x] 6.2 Trigger a provider retry and confirm the `SessionBanner` shows the single-card error + animated retry strip + Stop, using severity tokens (spot-check dark + one light theme).
