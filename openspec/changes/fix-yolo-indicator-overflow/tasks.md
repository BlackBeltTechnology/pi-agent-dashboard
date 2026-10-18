# Tasks — fix-yolo-indicator-overflow

Design: `design.md` D1–D7 (regenerated 2026-10-18). Manifest: `test-plan.md` (42 rows: 38 automated, 4 manual-only).
Test-first: author the section 5 / 6 scenario tests as failing before the matching implementation task in sections 1–4, then make them pass.

## 1. Remove the inline indicators (D1)

- [ ] 1.1 Delete `YoloPill` and `YoloSessionIndicator` from `packages/client/src/components/access-grant/YoloIndicators.tsx`; keep `useLiveYoloSession`, `yoloRemainingLabel`, `yoloTone` (used by `YoloActivation.tsx`, `YoloAccessCard.tsx`).
- [ ] 1.2 Remove the `YoloSessionIndicator` import and both mounts from `packages/client/src/components/session/SessionHeader.tsx` (`:13`, `:322`, `:492`).
- [ ] 1.3 Remove `<YoloPill />` from `packages/client/src/components/session/SessionList.tsx` (`:2830-2831`).

## 2. Sidebar row-1 tint (D2)

- [ ] 2.1 Add `useYoloAppBar()` to `YoloIndicators.tsx` returning `{ className, title, "data-yolo" }` while live (else `{}`): `bg-[var(--severity-warning-bg)] shadow-[inset_0_-2px_0_var(--accent-orange-text)]`, `title` = selected coverage sentence; reads `useYoloStatus()` (no `useNow`) and schedules one `setTimeout` at `expiresAt`; no click handler.
- [ ] 2.2 Add `YoloBarLink` (`<a href="/settings/access" onClick={openAccess} data-testid="yolo-bar-link">`, text = coverage sentence, classes `absolute left-2 top-full z-popover max-w-[20rem] rounded border px-2 py-1 text-xs bg-[var(--bg-secondary)] opacity-0 pointer-events-none focus:opacity-100 focus:pointer-events-auto focus-ring`; `null` when not live).
- [ ] 2.3 Change `useOpenAccess` to skip `preventDefault` for `e.button !== 0` or any of meta / ctrl / shift / alt.
- [ ] 2.4 In `SessionList.tsx`, spread `useYoloAppBar()` onto `header-app-bar` (merge `className`, add `relative`) and render `<YoloBarLink />` as its first child.

## 3. Composer strip (D3)

- [ ] 3.1 Add `YoloComposerStrip({ cwd, store })` to `YoloIndicators.tsx`: wrapper `shrink-0 px-3 pt-2`; strip `div` (`data-testid="yolo-composer-strip"`, `data-scope`, D3 classes + `yoloTone`); link (shield `aria-hidden` + sentence `truncate min-w-0`, `title`, `onClick={openAccess}`); time span outside the link (`formatRemaining(ms)` or `∞` `aria-hidden` + sr-only `yolo.noExpiry`); no role / `aria-live`; `null` unless live and `isCwdInYoloScope(cwd, session)`.
- [ ] 3.2 Mount it in `packages/client/src/App.tsx` inside `{!readOnly && (…)}`, after `QueuePanel`, immediately before `<CommandInput>`, `cwd={selectedSession?.cwd}`.
- [ ] 3.3 Mount it in `packages/client/src/components/folder/DirectoryHomeView.tsx` after `AgentSelect`, immediately before `<CommandInput>`, `cwd={cwd}`.
- [ ] 3.4 Leave `packages/client/src/components/chat/CommandInput.tsx` and `packages/team-app` unchanged.

## 4. Copy (D5, D6)

- [ ] 4.1 Add `yolo.coverage`, `yolo.coverageUnscoped`, `yolo.coverageForever`, `yolo.coverageUnscopedForever`, `yolo.noExpiry` with the D5 English inline fallbacks; select by `session.unscoped` × `remainingMs(...) === null`; delete `yolo.pill`, `yolo.pillUnscoped`, `yolo.pillTitle`, `yolo.pillTitleUnscoped`, `yolo.sessionScoped`, `yolo.sessionUnscoped` from the component.
- [ ] 4.2 Mirror in `packages/client/src/lib/i18n/i18n-hu.ts` (delete `:1800-1803`, `:1812-1813`) and `i18n-zh-CN.ts` (delete `:1279-1282`, `:1291-1292`); keep `yolo.left` / `yolo.untilServerStops`; author the `zh-CN` strip sentences no wider than `hu`; run `npm run i18n:parity`.
- [ ] 4.3 Retarget legacy tests: pill / session-indicator cases in `YoloIndicators.test.tsx`; `SessionList.yolo-pill.test.tsx` → bar tint; `SessionList.question-pill.test.tsx:84` (`yolo-pill` anchor → `tunnel-btn`); `SessionHeader.yolo.test.tsx` → absence; `tests/e2e/access-grant-dialog.spec.ts` (`yolo-pill` `:380`, `:420`; `yolo-session-indicator` `:429-430`).

## 5. Scenario tests — L1 (from test-plan.md)

- [ ] 5.1 In `packages/client/src/components/access-grant/__tests__/YoloIndicators.test.tsx` (see same file): input 60-min session at t0, t0+1 s, 1 s remaining; trigger render strip and advance fake clock; observable time text `1:00:00` / `59:59` / `0:01`, time node `shrink-0 tabular-nums` (test-plan #E9)
- [ ] 5.2 In `YoloIndicators.test.tsx` (see same file): input scoped + unscoped session; trigger render strip; observable wrapper `shrink-0 px-3 pt-2`, strip classes, link holds shield + `truncate min-w-0` sentence, time span is a sibling of the link (test-plan #E10)
- [ ] 5.3 In `YoloIndicators.test.tsx` (see same file): input scoped/unscoped × expiresAt set/null; trigger render a `useYoloAppBar` consumer, `YoloBarLink`, strip; observable bar `title`, link text, strip sentence + `title` = matching `yolo.coverage*`, `∞` `aria-hidden` + sr-only `yolo.noExpiry`, `*Forever` contains "until the server stops" (test-plan #E11)
- [ ] 5.4 In `YoloIndicators.test.tsx` (see same file): input scoped vs unscoped expiring; trigger render strip; observable `yoloTone(true)` vs `yoloTone(false)`, `--severity-warning-*`, `data-scope` differs, no `∞` (test-plan #E12)
- [ ] 5.5 In `YoloIndicators.test.tsx` (see same file): input scoped + unscoped expiring; trigger render; observable sentence contains "agent" and "dashboard", only unscoped contains "every folder", no `\d+:\d\d` (test-plan #E13)
- [ ] 5.6 In `YoloIndicators.test.tsx` (see `scripts/__tests__/repo-hygiene.test.mjs` `i18n-parity exits 0`): input hu / zh-CN catalogues + component source; trigger import + read + `node scripts/i18n-parity.mjs`; observable new keys present, six deleted keys absent, `yolo.left` / `untilServerStops` present, parity exits 0 (test-plan #E14)
- [ ] 5.7 In `packages/client/src/components/__tests__/SessionList.yolo-pill.test.tsx` (see same file): input active session; trigger render SessionList; observable `data-yolo`, tint classes, `title`, `yolo-bar-link` first child with `opacity-0 absolute`, row-1 testids unchanged, no `yolo-pill` (test-plan #E16)
- [ ] 5.8 In `packages/client/src/components/__tests__/SessionList.question-pill.test.tsx` (see same file): input one open question, YOLO active then none; trigger render SessionList; observable `question-pill` index == `tunnel-btn` index + 1 in both states (test-plan #E17)
- [ ] 5.9 In `packages/client/src/components/__tests__/SessionHeader.yolo.test.tsx` (see same file): input live session, cwd in scope; trigger render desktop and mobile header; observable no `yolo-session-indicator`, no YOLO text (test-plan #E18)
- [ ] 5.10 In `SessionList.yolo-pill.test.tsx` (see same file): input SessionList with active 15-min session, fake timers, React Profiler `onRender`; trigger advance 5 s; observable SessionList commits ≤ 1 (test-plan #P1)
- [ ] 5.11 In `YoloIndicators.test.tsx` (see same file): input bar, link, strip mounted; trigger walk each node to `document.body`; observable no live-region role, no `aria-live` ≠ `off` (test-plan #F1)
- [ ] 5.12 In `YoloIndicators.test.tsx` (see same file): input 15-min session; trigger `vi.advanceTimersByTime(1000)`; observable strip time changes, bar `title`, bar link name, strip link name + `title` identical, strip link name has no `\d+:\d\d` (test-plan #F2)
- [ ] 5.13 In `YoloIndicators.test.tsx` (see same file): input 15-min session; trigger advance 15 min; observable bar loses classes / `title` / `data-yolo`, link and strip unmount (test-plan #F3)
- [ ] 5.14 In `YoloIndicators.test.tsx` (see same file): input scoped session republished unscoped; trigger `yoloStatus.publish`; observable sentence switches to `coverageUnscoped`, `data-scope` / `data-yolo` flip, strip tone switches (test-plan #F4)
- [ ] 5.15 In `YoloIndicators.test.tsx` (see same file): input scoped session, composer cwd outside root; trigger render strip + bar consumer; observable strip absent, bar tinted (test-plan #F5)
- [ ] 5.16 In `YoloIndicators.test.tsx` (see same file): input active session; trigger query dismiss controls, press Escape; observable none, signals still rendered (test-plan #F6)
- [ ] 5.17 In `YoloIndicators.test.tsx` (see same file): input bar link and strip link; trigger click with button 0 / 1 and each modifier; observable unmodified primary → `defaultPrevented` + route `/settings/access`, others → not prevented, route unchanged (test-plan #F7)

## 6. Scenario tests — L3 (from test-plan.md)

- [ ] 6.1 Create `tests/e2e/yolo-indicator-layout.spec.ts` (see `tests/e2e/access-grant-dialog.spec.ts`): input YOLO scoped / unscoped, en / hu, 375 (drawer opened) / 768 / 1500 × ≥600; trigger render sidebar with and without YOLO; observable equal `header-app-bar` heights, identical visible testids (test-plan #E1)
- [ ] 6.2 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/access-grant-dialog.spec.ts`): input unscoped, en, 1500; trigger Tab to `yolo-bar-link`; observable link visible, bar height unchanged (test-plan #E2)
- [ ] 6.3 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/mobile-viewport-bound.spec.ts`): input scoped (cwd in scope) / unscoped, en / hu, 375 / 768 / 1500 × ≥600; trigger open session detail; observable strip one line box, right ≤ composer column right, time legible (test-plan #E3)
- [ ] 6.4 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/mobile-viewport-bound.spec.ts`): input scoped / unscoped, en / hu, 375 / 1500; trigger open folder home; observable E3 assertions on the folder-home strip (test-plan #E4)
- [ ] 6.5 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/mobile-viewport-bound.spec.ts`): input unscoped, 768×600, 40-line draft; trigger type draft; observable strip still one line box, composer card scrolls (test-plan #E5)
- [ ] 6.6 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/access-grant-dialog.spec.ts`): input unscoped, hu, host forced to preferred − 1 px; trigger render; observable sentence ellipsed, shield + time legible, one line, right ≤ host right (test-plan #E6)
- [ ] 6.7 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/access-grant-dialog.spec.ts`): input unscoped, hu, host forced to the measured floor; trigger render; observable shield + time legible, one line, right ≤ host right (test-plan #E7)
- [ ] 6.8 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/lazy-islands.spec.ts` for language setup): input unscoped, 1500, hu then zh-CN; trigger measure sentence `scrollWidth`; observable hu ≥ zh-CN (test-plan #E8)
- [ ] 6.9 Extend the "10.66 / E50" row-1 test in `tests/e2e/access-grant-dialog.spec.ts` (see same file): input `DELETE /api/access/yolo`; trigger render sidebar; observable no `data-yolo`, no `title`, no `yolo-bar-link`, control set unchanged (test-plan #E15)
- [ ] 6.10 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/access-grant-dialog.spec.ts`): input unscoped YOLO, archived session; trigger open read-only from the archive list; observable no `composer-card`, no strip, no header indicator, bar tinted (test-plan #E19)
- [ ] 6.11 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/mobile-viewport-bound.spec.ts`): input session detail, 1500; trigger render; observable strip outside `composer-card`, strip.bottom ≤ composer root top (test-plan #E20)
- [ ] 6.12 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/lazy-islands.spec.ts` for theme/language setup): input YOLO active, each named theme × light/dark; trigger read computed colours; observable text-secondary / text-tertiary on tint ≥ 4.5:1 or ≥ 0.85 × untinted contrast, underline ≥ 3:1 (test-plan #E21)
- [ ] 6.13 In `tests/e2e/access-grant-dialog.spec.ts` (see same file): input unscoped, en; trigger `hover()` bar background and strip link; observable `title` == coverage sentence, URL unchanged (test-plan #F8)
- [ ] 6.14 In `access-grant-dialog.spec.ts` (see same file): input 1500; trigger Tab to `yolo-bar-link`, Enter; observable URL `/settings/access`, window marker survives (no reload), access card visible (test-plan #F9)
- [ ] 6.15 In `access-grant-dialog.spec.ts` (see same file): input `hasTouch: true`, 375; trigger tap strip sentence, then strip time; observable sentence → `/settings/access` with planes / agent path gate / scope named, time tap → URL unchanged (test-plan #F10)
- [ ] 6.16 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/access-grant-dialog.spec.ts`): input active, 1500; trigger click bar background, click inside open ThemePicker dropdown padding, click question-panel scrim; observable URL unchanged each time, dropdown / panel behave as without YOLO (test-plan #F11)
- [ ] 6.17 In `access-grant-dialog.spec.ts` (see same file): input scoped, cwd in scope, 375 drawer closed and desktop sidebar collapsed; trigger render session; observable strip visible with time (test-plan #F12)
- [ ] 6.18 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/lazy-islands.spec.ts`): input `page.route` aborts `/assets/i18n-hu-*.js`, hu, unscoped; trigger load; observable English fallbacks, E1 + E3 hold (test-plan #X1)
- [ ] 6.19 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/lazy-islands.spec.ts`): input 3 s delay on hu chunk; trigger load hu; observable en then hu, strip one line and bar height unchanged at both moments (test-plan #X2)
- [ ] 6.20 In `yolo-indicator-layout.spec.ts` (see `tests/e2e/access-grant-dialog.spec.ts`): input `page.route` 500 on `/api/access/prompts`, server YOLO active; trigger load; observable no crash, no tint, no strip (test-plan #X3)
- [ ] 6.21 Extend `tests/e2e/agent-path-gate.spec.ts` (see same file): input YOLO + agent path-gate prompt; trigger auto-allow; observable Access lists agent-path-gate entry answered by yolo, `/api/health` count +1 (test-plan #X4)

## 7. Manual checks (post-merge)

- [ ] 7.1 Manual: VoiceOver / NVDA on the composer strip — time read in browse order, not re-announced while the link is focused (test-plan #F13, test-plan: manual-only)
- [ ] 7.2 Manual: orange YOLO surfaces read correctly next to worktree chips and working-yellow cards in three themes (test-plan #F14, test-plan: manual-only)
- [ ] 7.3 Manual: a sighted operator without hover recognises the tinted bar as YOLO given the strip (recorded deviation) (test-plan #F15, test-plan: manual-only)
- [ ] 7.4 Manual: strip ellipsis at 375 px in `hu` looks right in three themes (test-plan #F16, test-plan: manual-only)

## 8. Verification and docs

- [ ] 8.1 `npm test` — YOLO, header, sidebar and question-pill suites pass.
- [ ] 8.2 `npm run test:e2e` for the new and extended specs (`docker/test-up.sh` / `test-down.sh`).
- [ ] 8.3 `npm run quality:changed`; `node scripts/theme-token-guard.mjs` reports no new violation.
- [ ] 8.4 Update AGENTS rows with `See change: fix-yolo-indicator-overflow`: `YoloIndicators.tsx` (access-grant/AGENTS.md), `SessionList.tsx` / `SessionHeader.tsx` sidecars, `App.tsx`, `DirectoryHomeView.tsx`, `i18n-hu.ts` / `i18n-zh-CN.ts`, and a row for `tests/e2e/yolo-indicator-layout.spec.ts`.
