## Why

Issue: https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/898

With YOLO "everywhere" (unscoped) active, both active-YOLO indicators wrap and
reflow their host rows:

- **Session header** — `YoloSessionIndicator` renders a full sentence
  (`YOLO everywhere: agent + dashboard file access auto-allowed on every folder · 35:23 left`)
  in a `flex items-center gap-4` row with no `whitespace-nowrap`, no
  `flex-shrink-0` and no max-width
  (`packages/client/src/components/access-grant/YoloIndicators.tsx:114`; row
  container `packages/client/src/components/session/SessionHeader.tsx:427`,
  mount `SessionHeader.tsx:492`). The anchor is
  shrunk below its text width, the text wraps to 2 lines, and the session title,
  `Changed Files` chip and elapsed time wrap with it.
- **Sidebar top bar** — `YoloPill` (`YoloIndicators.tsx:92`) sits in `flex gap-1 items-center`
  ( right group `SessionList.tsx:2827`, mount
  `SessionList.tsx:2831`) with the same missing
  `whitespace-nowrap` / `flex-shrink-0`, so `YOLO everywhere 35:23` wraps to 3
  lines, growing `header-app-bar` and misaligning `Local • Connected`.

Two defects found while verifying the report, both in scope because the fix
rewrites exactly these nodes:

- `YoloSessionIndicator` carries `role="status"` (`YoloIndicators.tsx:111`) and
  re-renders every second from `useNow` (`packages/client/src/lib/time/use-now.ts:13`),
  so the live region re-announces the whole sentence once per second.
- `YoloSessionIndicator` has no `title` and no `aria-label`; shortening its
  visible copy would drop the coverage explanation entirely unless an accessible
  name is added at the same time.

## What Changes

Reviewed on the mockup board (`mockups/index.html` §R frame Y4, §0 variant B;
`mockups/ui-plan.md`) and in doubt-review. The fix removes the wrapping
elements instead of making them shrink:

- **Both inline indicators are deleted.** `YoloPill` (sidebar row 1) and
  `YoloSessionIndicator` (session header, desktop + mobile) and their mounts go.
  The session header no longer carries YOLO; this also removes the per-second
  `role="status"` announcement and the ticking pill name.
- **Sidebar row 1 is tinted while YOLO is live.** `header-app-bar` gets
  `--severity-warning-bg` and a 2 px inset underline in `--accent-orange-text`
  (inset shadow → row height unchanged). No visible control is added. The bar's
  `title` is the static coverage sentence; a link visually hidden until focused
  (first child, overlays below the bar on focus, no reflow) carries the same
  sentence and opens `/settings/access` (SPA navigation; modified clicks open a
  new tab). The bar has no click handler of its own. It shows no word: its
  colour-only meaning without hover is a recorded deviation from
  `theme-gallery` *Accent-text hue is a secondary cue* (operator decision).
  Row 1 no longer shows the remaining time.
- **New composer strip `YoloComposerStrip`.** One full-width strip directly above
  the dashboard prompt composer — the session composer (`App.tsx`, after
  `QueuePanel`, immediately before `<CommandInput>`, scoped by the session `cwd`)
  and the folder-home composer (`DirectoryHomeView.tsx`, after `AgentSelect`,
  immediately before `<CommandInput>`, scoped by the folder `cwd`). Content: a
  link (shield + the static coverage sentence, visible, ellipsed when narrow;
  static accessible name; `title` = sentence) and, outside the link, the
  remaining time as plain text (`∞` plus screen-reader text when it never
  expires). No live region; single line; sentence degrades first. Uses
  `yoloTone` (`--severity-warning-*`; unscoped `border-2 font-bold`).
- **Copy.** Four static coverage keys (`yolo.coverage`, `yolo.coverageUnscoped`,
  `yolo.coverageForever`, `yolo.coverageUnscopedForever`) and `yolo.noExpiry`
  are added; `yolo.pill`, `yolo.pillUnscoped`, `yolo.pillTitle`,
  `yolo.pillTitleUnscoped`, `yolo.sessionScoped`, `yolo.sessionUnscoped` are
  deleted. English defaults are inline `i18nT` fallbacks; `hu` / `zh-CN` mirror.
- Mockup: `mockups/index.html` (in this change).

## Capabilities

### Modified Capabilities

This change deliberately **narrows** the *unmissable* requirement: the
remaining time leaves the sidebar row (shown on composers and the Access page
only), and session surfaces without a composer lose their in-content indicator.
Both were operator decisions on the mockup board.

- `openspec/specs/access-grant-yolo/spec.md` — *An active YOLO session is
  unmissable and fully recorded*: signals are the tinted sidebar row (tooltip +
  focus-revealed link, no time, no click handler), the composer strip on every
  dashboard prompt composer in scope (time + visible description), and the
  Access page. No session-header indicator. Strip layout, degradation floor,
  `∞`, no live region, scope distinction on the strip.
- `openspec/specs/sidebar-header/spec.md` — *Row 1 carries an active-YOLO
  indicator* (indicator = tint, no control, height unchanged); *Two-row header
  layout* (row-1 list no longer names a YOLO indicator); *Row 1 carries an
  open-questions pill* (anchored immediately after `TunnelButton`).

### New Capabilities

None.

## Non-goals

- The `team-app` composer and any change to `CommandInput.tsx`.
- Archived / read-only session surfaces (no composer; no in-content signal).
- Row 1's own overflow at narrow sidebar widths, with or without YOLO.
- New colour tokens; caution stays orange per `message-severity-tokens`.
- A focus-visible tooltip primitive; YOLO semantics, scope, expiry, Access page.
- No dependency on `fix-slot-pill-legend-and-stale-overflow`.

## Discipline Skills

- `review-code` — before commit, per the repo checkpoint table.
- No other `eng-disciplines` checkpoint applies: client-only presentational
  change, no auth/untrusted input/PII, no latency budget, no new endpoint.

## Impact

- Code: `packages/client/src/components/access-grant/YoloIndicators.tsx`
  (delete `YoloPill`, `YoloSessionIndicator`; add `useYoloAppBar`, `YoloBarLink`,
  `YoloComposerStrip`; keep `useLiveYoloSession`, `yoloRemainingLabel`,
  `yoloTone` for `YoloActivation.tsx` / `YoloAccessCard.tsx`),
  `packages/client/src/components/session/SessionList.tsx` (bar tint + link;
  remove pill), `packages/client/src/components/session/SessionHeader.tsx`
  (remove two mounts + import), `packages/client/src/App.tsx` and
  `packages/client/src/components/folder/DirectoryHomeView.tsx` (strip mounts),
  `packages/client/src/lib/i18n/i18n-hu.ts`, `i18n-zh-CN.ts`, AGENTS rows.
- Tests: `packages/client/src/components/access-grant/__tests__/YoloIndicators.test.tsx`
  (rewritten for bar/link/strip),
  `packages/client/src/components/__tests__/SessionList.yolo-pill.test.tsx` (→ bar tint),
  `packages/client/src/components/__tests__/SessionList.question-pill.test.tsx:84` (order anchored on `yolo-pill` →
  `tunnel-btn`), `packages/client/src/components/__tests__/SessionHeader.yolo.test.tsx` (→ asserts absence),
  `tests/e2e/access-grant-dialog.spec.ts` (`yolo-pill` at :380, :420;
  `yolo-session-indicator` at :429-430), new
  `tests/e2e/yolo-indicator-layout.spec.ts`.
- Compatibility: `data-testid="yolo-pill"` and `yolo-session-indicator` are
  removed; new `yolo-bar-link`, `yolo-composer-strip`, `data-yolo` on
  `header-app-bar`.
- Client-only: no server, protocol, or persistence change — no migration;
  rollback = revert the commit. Rebuild: `npm run build` +
  `curl -X POST http://localhost:8000/api/restart`.
