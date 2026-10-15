# Tasks — fix-yolo-indicator-overflow

Test-first: author the section 4 / 5 scenario tests (from `test-plan.md`) as failing before the matching implementation task in sections 1–3, then make them pass.

## 1. Layout contract

- [ ] 1.1 Restructure both anchors in `packages/client/src/components/access-grant/YoloIndicators.tsx` into marker (`shrink-0`) + label (`truncate min-w-0`) + time (`shrink-0 whitespace-nowrap tabular-nums`), with `whitespace-nowrap overflow-hidden min-w-0` and the D2 widths on the anchor: `max-w-[12rem]` on `YoloPill`, `max-w-[22rem] max-w-full` on `YoloSessionIndicator` (`max-w-full` because the mobile header is `flex flex-col` at `packages/client/src/components/session/SessionHeader.tsx:311` and the anchor keeps `self-start`).
- [ ] 1.2 Keep the existing `--severity-warning-*` token classes and the scoped/unscoped weight + border distinction from `yoloTone`; introduce no new colour literals.
- [ ] 1.3 Render the time slot as `formatRemaining(ms)` when `ms !== null` and `\u221e` otherwise in both components (D2b), replacing the session indicator's interpolation of `yoloRemainingLabel` into the visible string.

## 2. Copy and accessible name

- [ ] 2.1 Shorten the English strings for `yolo.sessionUnscoped`, `yolo.sessionScoped`, `yolo.pillUnscoped`, `yolo.pill` at their inline `i18nT(key, vars, fallback)` fallback arguments in `YoloIndicators.tsx:96-97` and `:119-123` (English has no catalogue file; `packages/client/src/lib/i18n/i18n.tsx:38` keeps `en` empty).
- [ ] 2.2 Add four static keys with English inline fallbacks — `yolo.coverage`, `yolo.coverageUnscoped`, `yolo.coverageForever`, `yolo.coverageUnscopedForever` (D1, Y3; the `*Forever` pair embeds the `yolo.untilServerStops` wording as literal text); select by `session.unscoped` × `remainingMs(...) === null`; use the selected string for the `title` and the sibling `sr-only` description node (id from `useId()` called before the early return) of both `YoloSessionIndicator` and `YoloPill`. Set no `aria-label` on either (remove the pill's, `YoloIndicators.tsx:91`); interpolate no `{remaining}`.
- [ ] 2.3 Mirror every changed key and the four `yolo.coverage*` keys, and delete `yolo.pillTitle` / `yolo.pillTitleUnscoped` (Y3), in `packages/client/src/lib/i18n/i18n-hu.ts:1776-1789` and `packages/client/src/lib/i18n/i18n-zh-CN.ts:1275-1288`; run `npm run i18n:parity`.
- [ ] 2.4 Rewrite the legacy assertions pinned to the long copy in `packages/client/src/components/access-grant/__tests__/YoloIndicators.test.tsx:106` (`/15:00 left/` on `textContent` → `/15:00/`, no "left") and `:151` (`/agent/i` on `textContent` → on `title` and on the `aria-describedby` target).

## 3. Announcement behaviour

- [ ] 3.1 Remove `role="status"` from `YoloSessionIndicator`, keeping `href`, `data-testid` and `data-scope` unchanged.

## 4. Scenario tests — L1 (from test-plan.md)

- [ ] 4.1 In `packages/client/src/components/access-grant/__tests__/YoloIndicators.test.tsx` (see same file): input 60-min session at t0, t0+1 s, 1 s remaining; trigger render both indicators and advance fake clock; observable time node text `1:00:00` / `59:59` / `0:01` with `shrink-0 whitespace-nowrap tabular-nums` (test-plan #E6)
- [ ] 4.2 In `YoloIndicators.test.tsx` (see same file): input unscoped + scoped session; trigger render pill + session indicator; observable separate marker/label/time nodes, marker+time `shrink-0`, label `truncate min-w-0`, anchor `whitespace-nowrap overflow-hidden min-w-0`, pill `max-w-[12rem]`, session `max-w-[22rem] max-w-full` (test-plan #E8)
- [ ] 4.3 In `YoloIndicators.test.tsx` (see same file): input 4 sessions scoped/unscoped × expiresAt set/null; trigger render both indicators; observable time node `formatRemaining(ms)` or `∞`, title/description text from the matching `yolo.coverage*` key, `*Forever` text contains "until the server stops" (test-plan #E12)
- [ ] 4.4 In `YoloIndicators.test.tsx` (see same file): input unscoped expiring vs scoped session; trigger render both; observable no `∞` in visible text, `yoloTone(true)` vs `yoloTone(false)` classes, `data-scope` differs (test-plan #E14)
- [ ] 4.5 In `YoloIndicators.test.tsx` (see same file): input unscoped + scoped expiring session; trigger render; observable description contains "agent" and "dashboard", only unscoped contains "every folder", no `\d+:\d\d` (test-plan #E15)
- [ ] 4.6 In `YoloIndicators.test.tsx` (see `scripts/__tests__/repo-hygiene.test.mjs` `i18n-parity exits 0`): input `i18n-hu.ts`, `i18n-zh-CN.ts`, `YoloIndicators.tsx` source; trigger import catalogues + read source; observable four `yolo.coverage*` keys present in hu and zh-CN, `yolo.pillTitle` / `yolo.pillTitleUnscoped` absent from both catalogues and the component source (test-plan #E16)
- [ ] 4.7 In `packages/client/src/components/__tests__/SessionList.yolo-pill.test.tsx` (see same file): input active session; trigger render SessionList header; observable pill present and every pre-existing row-1 testid still present (test-plan #E18)
- [ ] 4.8 In `packages/client/src/components/__tests__/SessionHeader.yolo.test.tsx` (see same file, replacing the `:33` `/YOLO.*\d+:\d\d left/` assertion): input 15-min session; trigger render SessionHeader; observable visible text = compact label + `/\d+:\d\d/`, no "left", no coverage sentence (test-plan #E19)
- [ ] 4.9 In `YoloIndicators.test.tsx` (see same file): input both indicators mounted in SessionHeader + SessionList trees; trigger walk anchor → `document.body`; observable no role in {status,alert,log,timer,marquee} and no `aria-live` other than `off` (test-plan #F1)
- [ ] 4.10 In `YoloIndicators.test.tsx` (see same file): input 15-min session; trigger `vi.advanceTimersByTime(1000)`; observable visible time changes, `title` and `aria-describedby` target text identical before/after, pill has no `aria-label` (test-plan #F2)
- [ ] 4.11 In `YoloIndicators.test.tsx` (see same file): input both indicators; trigger `getByRole("link",{name})`; observable name == compact label + time and excludes description, `anchor.contains(descNode) === false`, desc has `sr-only` (test-plan #F3)
- [ ] 4.12 In `YoloIndicators.test.tsx` (see same file): input two `YoloSessionIndicator` + one `YoloPill`, session null → active → null via `yoloStatus`; trigger publish; observable no hook-order error, 3 distinct `aria-describedby` ids each resolving to an existing node (test-plan #F4)
- [ ] 4.13 In `YoloIndicators.test.tsx` (see same file): input 15-min session; trigger advance 15 min; observable both indicators unmount and no stray `sr-only` description node remains (test-plan #F5)
- [ ] 4.14 In `YoloIndicators.test.tsx` (see same file): input scoped session republished unscoped; trigger `yoloStatus.publish`; observable description `yolo.coverage` → `yolo.coverageUnscoped`, `data-scope` flips, label switches to "everywhere" form (test-plan #F6)
- [ ] 4.15 In `SessionHeader.yolo.test.tsx` (see same file): input scoped session with cwd outside root; trigger render SessionHeader; observable `yolo-session-indicator` absent, pill still present (test-plan #F11)
- [ ] 4.16 In `YoloIndicators.test.tsx` (see same file): input active session; trigger query dismiss controls and press Escape; observable no dismiss button, indicator still rendered (test-plan #F12)

## 5. Scenario tests — L3 (from test-plan.md)

- [ ] 5.1 Create `tests/e2e/yolo-indicator-layout.spec.ts` (see `tests/e2e/access-grant-dialog.spec.ts`): input unscoped 60-min YOLO, lang en/hu, viewport 375 (drawer opened)/768/1500 × ≥600; trigger render sidebar; observable pill height == line-height + vertical padding + border, pill.right ≤ row1.right, row1 height ≤ no-YOLO height (test-plan #E1)
- [ ] 5.2 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/access-grant-dialog.spec.ts`): input scoped YOLO on fixture git root, session cwd in scope, same width × lang matrix; trigger render sidebar + session; observable E1 assertions hold for pill and session indicator (test-plan #E2)
- [ ] 5.3 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/mobile-viewport-bound.spec.ts`): input unscoped YOLO, en/hu, 768 and 1500 × ≥600; trigger render desktop session header; observable indicator height == one line box, indicator.right ≤ host row right, host row height ≤ no-YOLO height (test-plan #E3)
- [ ] 5.4 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/mobile-viewport-bound.spec.ts`): input unscoped YOLO, en/hu, 375 × ≥600; trigger render `MobileHeader`; observable indicator height == one line box, indicator.right ≤ header.right, header height ≤ no-YOLO height + indicator height (test-plan #E4)
- [ ] 5.5 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/mobile-viewport-bound.spec.ts`): input viewports 767×600, 768×599, 768×600; trigger render session; observable first two render `MobileHeader` with E4 assertions, 768×600 renders desktop row with E3 assertions (test-plan #E5)
- [ ] 5.6 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/access-grant-dialog.spec.ts`): input 60-min unscoped session, hu, 375 drawer + mobile header within first second (`1:00:00`); trigger render; observable single-line + right-edge assertions hold and time node legible (test-plan #E7)
- [ ] 5.7 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/access-grant-dialog.spec.ts`): input unscoped YOLO, hu, host width forced to preferred − 1 px; trigger render; observable label `text-overflow: ellipsis` with scrollWidth > clientWidth, marker+time legible, one line box, indicator.right ≤ host.right (test-plan #E9)
- [ ] 5.8 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/access-grant-dialog.spec.ts`): input unscoped YOLO, hu, host width forced to exactly the floor (marker + time + padding + border); trigger render; observable marker+time legible, one line box, indicator.right ≤ host.right; no width below the floor is tested (Y1) (test-plan #E10)
- [ ] 5.9 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/lazy-islands.spec.ts` for language setup): input unscoped YOLO, 1500 × ≥600, lang `hu` then `zh-CN`; trigger measure label `scrollWidth` of pill and session indicator; observable `hu` ≥ `zh-CN` for each indicator (Y2) (test-plan #E11)
- [ ] 5.10 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/lazy-islands.spec.ts` for `page.route`): input `/api/access/prompts` yolo payload stubbed with `expiresAt: null`, unscoped, hu, 375/1500; trigger render; observable time slot `∞` and single-line + right-edge assertions hold (test-plan #E13)
- [ ] 5.11 Extend the "10.66 / E50" row-1 test in `tests/e2e/access-grant-dialog.spec.ts` (see same file): input no YOLO session (`DELETE /api/access/yolo`); trigger render sidebar; observable `yolo-pill` count 0 and row-1 control set unchanged (test-plan #E17)
- [ ] 5.12 In `tests/e2e/access-grant-dialog.spec.ts` (see same file): input unscoped session, en; trigger `hover()` on indicator; observable `title` == description node text, URL unchanged (test-plan #F7)
- [ ] 5.13 In `tests/e2e/access-grant-dialog.spec.ts` (see same file): input context `hasTouch:true`, 375; trigger `tap()` on session indicator; observable URL `/settings/access`, `yolo-access-active` visible naming planes, agent path gate and scope (test-plan #F8)
- [ ] 5.14 In `tests/e2e/access-grant-dialog.spec.ts` (see same file): input 1500 viewport; trigger Tab to `yolo-pill` + Enter; observable URL `/settings/access`, access card visible (test-plan #F9)
- [ ] 5.15 In `tests/e2e/access-grant-dialog.spec.ts` (see same file): input scoped session with cwd in scope, 375 drawer closed and desktop with sidebar collapsed; trigger render session; observable `yolo-pill` not visible, `yolo-session-indicator` visible with time (test-plan #F10)
- [ ] 5.16 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/lazy-islands.spec.ts`): input `page.route` aborts `/assets/i18n-hu-*.js`, lang hu, unscoped YOLO; trigger load; observable English fallbacks and E1 single-line + right-edge assertions hold (test-plan #X1)
- [ ] 5.17 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/lazy-islands.spec.ts`): input 3 s delay on hu chunk; trigger load with lang hu; observable en then hu strings, single line and row1 height ≤ no-YOLO height at both moments (test-plan #X2)
- [ ] 5.18 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/access-grant-dialog.spec.ts`): input `page.route` 500 on `/api/access/prompts` with server-side YOLO active; trigger load; observable no crash, header layout equals no-YOLO layout (test-plan #X3)
- [ ] 5.19 Extend `tests/e2e/agent-path-gate.spec.ts` (see same file): input YOLO active and an agent path-gate prompt; trigger auto-allow; observable Access surface lists the agent-path-gate entry answered by yolo, `/api/health` auto-allow count +1 (test-plan #X4)

## 6. Manual checks (post-merge)

- [ ] 6.1 Manual: with VoiceOver/NVDA focused on an indicator for 5 ticks, the ticking name is not intrusively re-announced (test-plan #F13, test-plan: manual-only)
- [ ] 6.2 Manual: scoped vs unscoped indicators are visibly distinguishable side by side in light and dark themes (test-plan #F14, test-plan: manual-only)
- [ ] 6.3 Manual: label ellipsis/clipping at 375 px drawer in `hu` looks right in all three themes (test-plan #F15, test-plan: manual-only)

## 7. Verification and docs

- [ ] 7.1 Run `npm test` and confirm the YOLO indicator suite and the header/sidebar suites pass.
- [ ] 7.2 Run `npm run test:e2e` for the new and extended specs (opt-in; `docker/test-up.sh` / `test-down.sh` for the harness).
- [ ] 7.3 Run `npm run quality:changed` and clear new findings on the touched files.
- [ ] 7.4 Update the `YoloIndicators.tsx` row in `packages/client/src/components/access-grant/AGENTS.md`, the `i18n-hu.ts` / `i18n-zh-CN.ts` rows in `packages/client/src/lib/i18n/AGENTS.md`, the test note in `packages/client/src/components/session/SessionHeader.tsx.AGENTS.md`, and add a row for the new spec in `tests/e2e/AGENTS.md`, each with `See change: fix-yolo-indicator-overflow`.
