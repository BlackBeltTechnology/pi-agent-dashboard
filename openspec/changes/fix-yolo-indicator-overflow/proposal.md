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
- **Sidebar top bar** — `YoloPill` sits in `flex gap-1 items-center`
  (`YoloIndicators.tsx:92`; right group `SessionList.tsx:2770`, mount
  `SessionList.tsx:2774`) with the same missing
  `whitespace-nowrap` / `flex-shrink-0`, so `YOLO everywhere 35:23` wraps to 3
  lines, growing `header-app-bar` and misaligning `Local • Connected`.

Two defects found while verifying the report, both in scope because the fix
rewrites exactly these nodes:

- `YoloSessionIndicator` carries `role="status"` (`YoloIndicators.tsx:111`) and
  re-renders every second from `useNow` (`packages/client/src/lib/time/use-now.ts:8`),
  so the live region re-announces the whole sentence once per second.
- `YoloSessionIndicator` has no `title` and no `aria-label`; shortening its
  visible copy would drop the coverage explanation entirely unless an accessible
  name is added at the same time.

## What Changes

- Both indicators become single-line and shrink-proof: the shield marker and the
  remaining time always stay legible; only the descriptive label degrades (CSS
  ellipsis) when width runs out. Neither indicator may wrap (its height is one
  line box) or extend past its host row. Horizontal host rows (sidebar row 1,
  desktop session header row) keep their no-YOLO height; the mobile session
  header is a `flex flex-col` stack (`SessionHeader.tsx:311-323`), so there the
  indicator adds exactly one line of its own height and no more. Verified at
  375 / 768 / 1500 px (viewport height ≥ 600 px) in `en` and `hu`.
- Session header indicator shows a compact label (shield + short "YOLO
  everywhere" / "YOLO" form + remaining time); a **static** coverage sentence
  (no countdown interpolated; four keys: scoped/unscoped × expiring/never-expiring)
  moves to the pointer tooltip (`title`) **and** to a visually hidden sibling
  element wired with `aria-describedby`, so assistive technology reads it on
  focus. Touch and sighted keyboard-only users (no assistive technology) reach it
  by one tap / Enter on the link — the Access page states
  the planes, the agent path gate and the folder coverage
  (`packages/client/src/components/access-grant/YoloAccessCard.tsx:95-107`).
  A native `title` is not rendered on keyboard focus by browsers, so the spec
  clause is written to that reality rather than promising a visible tooltip.
- `role="status"` is dropped from the session indicator in favour of link
  semantics, ending the per-second live-region re-announcement.
- `YoloPill` gets the same treatment: its `title` / `aria-label` today
  interpolate `{remaining}` every tick (`YoloIndicators.tsx:74-91`). Its
  `aria-label` is removed (name = visible compact label + time) and its
  `title` + sibling `aria-describedby` description use the same static
  coverage sentence as the session indicator.
- Shorter visible strings for `yolo.sessionUnscoped`, `yolo.sessionScoped`,
  `yolo.pillUnscoped`, `yolo.pill`. English has no catalogue file — its defaults
  are the inline third argument of `i18nT(...)` in `YoloIndicators.tsx`
  (`i18n.tsx:38` keeps `en` as an empty dictionary), so the English work is in
  the component; `hu` and `zh-CN` are edited in `i18n-hu.ts:1776-1789` and
  `i18n-zh-CN.ts:1275-1288`. The `{remaining}`-interpolating `yolo.pillTitle`
  / `yolo.pillTitleUnscoped` keys are removed; both indicators share four static keys
  `yolo.coverage`, `yolo.coverageUnscoped`, `yolo.coverageForever`,
  `yolo.coverageUnscopedForever` (no `{remaining}`; the `*Forever` variants
  reuse the `yolo.untilServerStops` wording, `YoloIndicators.tsx:51-56`).
- Colours keep using the existing `--severity-warning-*` theme tokens; the
  unscoped/scoped distinction keeps the heavier border + bold weight
  (`YoloIndicators.tsx:36-41`), not a glyph.

## Capabilities

### Modified Capabilities

- `openspec/specs/access-grant-yolo/spec.md` — requirement *An active YOLO
  session is unmissable and fully recorded*: add the single-line / no-reflow
  layout invariant (375 / 768 / 1500 px, height ≥ 600 px, `en` + `hu`;
  indicator-only assertions; no-growth for horizontal host rows, one-line growth
  for the stacked mobile header), allow compact visible copy only when the
  coverage description is carried by the pointer tooltip **and** by the
  indicator's accessible description (pointer hover + assistive technology;
  touch / keyboard-without-AT path = Access page), and forbid either indicator
  or its ancestors from being a live region, with description and tooltip text
  identical across ticks.
- `openspec/specs/sidebar-header/spec.md` — requirement *Row 1 carries an
  active-YOLO indicator*: the pill SHALL stay single-line and SHALL NOT change
  row 1's height or extend past its right edge at the same named widths and
  locales; no promise about the other controls' placement.

### New Capabilities

None.

## Non-goals

- No change to YOLO semantics, scope matching, expiry, or the Access settings
  page indicator (it is a block-level surface with room for the full sentence).
- No new hover/focus tooltip primitive. The repo's only floating-panel
  primitive is `ui:popover` (`packages/client-utils/src/Popover.tsx`), which is
  explicitly click-anchored and "NOT a tooltip" (`Popover.tsx:11`); building a
  focus-visible tooltip is a separate change.
- No dependency on `fix-slot-pill-legend-and-stale-overflow`. Its
  `ui-state-capture` overflow probe is not on `develop`
  (`openspec/specs/ui-state-capture/spec.md` has no `overflow` list); it is
  named as an opportunistic regression vehicle only.

## Discipline Skills

- `review-code` — before commit, per the repo checkpoint table.
- No other `eng-disciplines` checkpoint applies: presentational client-only
  change, no auth/untrusted input/PII, no latency budget, no new endpoint.

## Impact

- `packages/client/src/components/access-grant/YoloIndicators.tsx` (both
  components), `packages/client/src/lib/i18n/i18n-hu.ts`,
  `packages/client/src/lib/i18n/i18n-zh-CN.ts`, and the directory `AGENTS.md`
  rows for the touched files.
- Tests: `packages/client/src/components/access-grant/__tests__/YoloIndicators.test.tsx`
  — including `:106` (asserts `/15:00 left/` on the session indicator's
  `textContent`) and `:151` (asserts `/agent/i` on its `textContent`); both pin
  the long visible copy and must be rewritten (`textContent` will also include
  nothing from the description, which is a sibling node),
  `packages/client/src/components/__tests__/SessionHeader.yolo.test.tsx:33`
  (asserts `/YOLO.*\d+:\d\d left/` on the visible text — the compact label drops
  the word "left" from the session indicator, so this assertion must be
  rewritten), and a new `tests/e2e/yolo-indicator-layout.spec.ts` for the real
  layout invariant (including the `hu` ≥ `zh-CN` label-width check, Y2);
  `tests/e2e/access-grant-dialog.spec.ts` and `tests/e2e/agent-path-gate.spec.ts`
  are extended for the interaction paths and regressions (see `test-plan.md`).
- Client-only: no server, protocol, or persistence change — no migration, no
  rollback step beyond reverting the commit. Rebuild path: `npm run build` +
  `curl -X POST http://localhost:8000/api/restart` (production) or Vite HMR in
  dev.
- Compatibility: `data-testid="yolo-pill"` / `data-testid="yolo-session-indicator"`
  and `data-scope` are preserved. Removing `role="status"` changes the queried
  role for any future `getByRole("status")` assertion; no current test uses it
  (`packages/client/src/components/access-grant/__tests__/YoloIndicators.test.tsx`
  queries by test id).
