# Test Plan — fix-yolo-indicator-overflow

Stage: design   Generated: 2026-10-14

Decisions applied: Y1 (below marker + time floor, no-overflow wins; band not verified — design D8),
Y2 (L3 check `hu` label width ≥ `zh-CN` for both indicators — design D9),
Y3 (shared `yolo.coverage*` keys; `yolo.pillTitle*` deleted — design D1).

Sources: proposal.md, design.md (D1–D9), specs/access-grant-yolo/spec.md, specs/sidebar-header/spec.md.

Harness facts: L3 port from `.pi-test-harness.json` (`dashboardPort`), never :18000; YOLO activated via
`POST /api/access/yolo {durationMinutes, unscoped|base}`, cleared via `DELETE /api/access/yolo`
(as in `tests/e2e/access-grant-dialog.spec.ts`); language via `localStorage["pi-dashboard-language"]`
(as in `tests/e2e/lazy-islands.spec.ts`); durations 15/30/60 min; `formatRemaining` renders `h:mm:ss`
when ≥ 3600 s else `m:ss`; indicator href `/settings/access`.
"Legible" (marker/time) = node `scrollWidth ≤ clientWidth` AND bounding box fully inside the anchor's box
AND computed `text-overflow` not applied to it. "Floor" = marker width + time width + anchor horizontal
padding + border (D8).

Harness exemplars (verified on disk):
- L1 indicators ← `packages/client/src/components/access-grant/__tests__/YoloIndicators.test.tsx`
- L1 header / sidebar ← `packages/client/src/components/__tests__/SessionHeader.yolo.test.tsx`, `packages/client/src/components/__tests__/SessionList.yolo-pill.test.tsx`
- L1 i18n parity ← `scripts/__tests__/repo-hygiene.test.mjs` (`i18n-parity exits 0`)
- L3 layout (new `tests/e2e/yolo-indicator-layout.spec.ts`) ← `tests/e2e/access-grant-dialog.spec.ts` (YOLO setup), `tests/e2e/mobile-viewport-bound.spec.ts` (viewport/layout), `tests/e2e/lazy-islands.spec.ts` (language + chunk `page.route`)
- L3 regression ← `tests/e2e/access-grant-dialog.spec.ts` (#E50 row-1 test), `tests/e2e/agent-path-gate.spec.ts`

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | AGY layout + SH row 1 (D7) | EP × decision-table (width × lang) | L3 | automated | unscoped 60-min YOLO; lang ∈ {en,hu}; viewport {375 (drawer opened),768,1500}×≥600 | render sidebar | `yolo-pill` height == computed line-height + padding-top/bottom + border-top/bottom; pill.right ≤ row1.right; row1 height ≤ row1 height with no YOLO at same width/lang |
| E2 | AGY layout "both scoped and unscoped" | decision-table (scope column) | L3 | automated | scoped YOLO on fixture git root; same width×lang matrix; session cwd in scope | render sidebar + session | same three assertions as E1 for the pill and for the session indicator |
| E3 | AGY desktop header row | EP (width 768/1500) | L3 | automated | unscoped YOLO; en,hu; session surface open | render desktop session header | `yolo-session-indicator` height == one line box; indicator.right ≤ host row (`SessionHeader.tsx:427`).right; host row height ≤ no-YOLO height |
| E4 | AGY mobile header grows by one line | EP (375) | L3 | automated | unscoped YOLO; en,hu; 375×≥600 | render `MobileHeader` | indicator height == one line box; indicator.right ≤ header.right; header height ≤ no-YOLO header height + indicator height |
| E5 | D7 layout selector boundary (`useMobile`: w<768 or h<600) | BVA | L3 | automated | viewport 767×600, 768×599, 768×600 | render session | 767×600 and 768×599 render `MobileHeader` and E4 assertions hold; 768×600 renders desktop row and E3 assertions hold |
| E6 | time slot legible (D2) | BVA (time string width) | L1 | automated | 60-min session at t0 (3600 s), t0+1 s, remaining 1 s | render both indicators, advance fake clock | time node text = `1:00:00` / `59:59` / `0:01`; time node has `shrink-0 whitespace-nowrap tabular-nums` |
| E7 | time slot legible at widest value | BVA | L3 | automated | 60-min unscoped session, hu, 375 drawer + mobile header, measured within first second (`1:00:00`) | render | E1/E4 single-line + right-edge assertions hold; time node legible |
| E8 | D2 structure (regression pin) | EP | L1 | automated | unscoped + scoped session | render pill + session indicator | marker/label/time separate nodes; marker+time `shrink-0`; label `truncate min-w-0`; anchor `whitespace-nowrap overflow-hidden min-w-0`; pill `max-w-[12rem]`; session `max-w-[22rem] max-w-full` |
| E9 | AGY/SH "narrower than preferred width → label ellipses, marker+time legible" | BVA (host width, valid side) | L3 | automated | unscoped YOLO, hu; host width forced via injected style to preferred − 1 px | render | label computed `text-overflow: ellipsis` and label.scrollWidth > label.clientWidth; marker+time legible; indicator height == one line box; indicator.right ≤ host.right |
| E10 | AGY/SH degradation floor (Y1, D8) | BVA (host width == floor) | L3 | automated | unscoped YOLO, hu; host width forced to exactly the floor (measured marker + time + padding + border) | render | marker+time legible; label clientWidth ≈ 0 or ellipsed; indicator height == one line box; indicator.right ≤ host.right. Widths below the floor are not tested (out of verified set, Y1) |
| E11 | verified-set premise "`hu` longest" (Y2, D9) | EP (locale) | L3 | automated | unscoped YOLO, unconstrained host (1500×≥600); lang `hu` then `zh-CN` | measure label `scrollWidth` for pill and session indicator per locale | for each indicator: `hu` label scrollWidth ≥ `zh-CN` label scrollWidth |
| E12 | env session time slot (D2b) + key selection | decision-table (unscoped × expiring) | L1 | automated | 4 sessions: scoped/unscoped × expiresAt set/null | render both indicators | time node = `formatRemaining(ms)` or `∞` (null); title/description = `yolo.coverage` / `coverageUnscoped` / `coverageForever` / `coverageUnscopedForever` text; `*Forever` contains "until the server stops" |
| E13 | env session still one line | EP | L3 | automated | `/api/access/prompts` yolo payload stubbed via `page.route` with `expiresAt: null`, unscoped, hu, 375/1500 | render | time slot text `∞`; E1/E3/E4 single-line + right-edge assertions hold |
| E14 | D3 distinction not via `∞` | decision-table | L1 | automated | unscoped expiring session vs scoped | render both | visible text has no `∞`; unscoped anchor carries `yoloTone(true)` classes, scoped `yoloTone(false)`; `data-scope` differs |
| E15 | coverage text truthful (D1) | EP | L1 | automated | unscoped + scoped, expiring | render | description contains "agent" and "dashboard"; unscoped contains "every folder", scoped does not; no `\d+:\d\d` |
| E16 | i18n catalogue (D5, Y3) | EP | L1 | automated | `i18n-hu.ts`, `i18n-zh-CN.ts`, `YoloIndicators.tsx` source | import catalogues + read source; `node scripts/i18n-parity.mjs` | 4 `yolo.coverage*` keys present in hu and zh-CN; `yolo.pillTitle` / `yolo.pillTitleUnscoped` absent from both catalogues and from `YoloIndicators.tsx`; parity exits 0 |
| E17 | SH "absent by default" | EP | L3 | automated | no YOLO session (`DELETE /api/access/yolo`) | render sidebar | `yolo-pill` count 0; row-1 control set unchanged |
| E18 | SH "appears, displaces nothing" | EP | L1 | automated | active session | render SessionList header | pill present; every pre-existing row-1 testid still present |
| E19 | visible label rewrite | EP | L1 | automated | 15-min session | render SessionHeader | visible text matches compact label + `/\d+:\d\d/`; contains neither "left" nor the coverage sentence |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | AGY no live region (D4) | invariant | L1 | automated | both indicators mounted in SessionHeader + SessionList trees | walk anchor → `document.body` | no node has role ∈ {status,alert,log,timer,marquee}; no `aria-live` ≠ `off` |
| F2 | AGY description static across ticks | state-transition (tick) | L1 | automated | 15-min session | `vi.advanceTimersByTime(1000)` | visible time changes; `title` and `aria-describedby` target text byte-identical before/after; pill has no `aria-label` |
| F3 | AGY name excludes description (D1) | invariant | L1 | automated | both indicators | `getByRole("link",{name})` | role=link; name == compact label + time; name excludes description text; `anchor.contains(descNode) === false`; desc has `sr-only` |
| F4 | `useId` distinct + hook order | state-transition (null→session→null) | L1 | automated | two `YoloSessionIndicator` + one `YoloPill`; session null → active → null | publish via `yoloStatus` | no React hook-order error; 3 distinct `aria-describedby` ids each resolving to an existing node |
| F5 | state transition: expiry | state-transition | L1 | automated | 15-min session | advance 15 min | both indicators unmount; no stray `sr-only` description node in DOM |
| F6 | state transition: scope change mid-session | state-transition | L1 | automated | scoped session → republished unscoped | `yoloStatus.publish` | description switches `yolo.coverage` → `yolo.coverageUnscoped`; `data-scope` flips; label switches to "everywhere" form |
| F7 | AGY hover path | EP | L3 | automated | unscoped session, en | `hover()` on indicator | `title` attr == description node text; page URL unchanged |
| F8 | AGY touch path | EP | L3 | automated | context `hasTouch:true`, 375 | `tap()` on session indicator | URL path `/settings/access`; `yolo-access-active` visible; planes, agent path gate and scope named |
| F9 | AGY keyboard path (no AT) | EP | L3 | automated | 1500 viewport | Tab to `yolo-pill`, press Enter | URL `/settings/access`; access card visible |
| F10 | AGY collapsed sidebar / SH "not the only signal" | state-transition (sidebar hidden) | L3 | automated | scoped session, cwd in scope; 375 (drawer closed) and desktop with sidebar collapsed | render session | `yolo-pill` not visible; `yolo-session-indicator` visible with time |
| F11 | out-of-scope session shows no session indicator | EP | L1 | automated | scoped session; cwd outside root | render SessionHeader | `yolo-session-indicator` absent; pill still present |
| F12 | not dismissible | EP | L1 | automated | active session | query dismiss controls; press Escape | no dismiss button inside/adjacent; indicator still rendered |
| F13 | ticking accessible name not re-announced on focus | — | — | manual-only | focused indicator, VoiceOver/NVDA | wait 5 ticks | [judgment: AT behaviour per browser/SR combo — not automatable in CI (design Risks)] |
| F14 | unscoped visually distinguishable | visual | — | manual-only | scoped vs unscoped side by side, light + dark theme | operator looks | [judgment: perceived distinction; E14 pins classes only] |
| F15 | ellipsis/clip looks right in all three themes | visual | — | manual-only | hu, 375 drawer | operator looks | [judgment: aesthetics] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | language catalogue lazy-load (hu) | fault-injection (abort) | L3 | automated | `page.route` aborts `/assets/i18n-hu-*.js` | load with lang=hu, unscoped YOLO | indicators render English fallbacks; E1 single-line + right-edge assertions hold |
| X2 | language catalogue delay | fault-injection (delay) | L3 | automated | 3 s delay on hu chunk | load with lang=hu | before load: en strings, single line; after load: hu strings, single line; row1 height ≤ no-YOLO height at both moments |
| X3 | yolo status fetch fails | fault-injection (abort) | L3 | automated | `page.route` 500 on `/api/access/prompts` | load with server-side YOLO active | no crash; header layout equals no-YOLO layout (indicator absent rather than malformed) |
| X4 | AGY auto-allow recorded (regression) | EP | L3 | automated | YOLO active; agent path-gate prompt fires | auto-allow | Access surface lists entry labelled agent path gate, answered by yolo; `/api/health` auto-allow count +1 |

---

## Coverage summary

- Requirements covered: 2/2 — AGY (all 12 scenarios) + SH (row-1 indicator, 4 scenarios).
- Scenarios by class: edge 19 · perf 0 · frontend 15 · error 4 (total 38)
- Scenarios by level: L1 16 · L2 0 · L3 19 · — 3
- Scenarios by disposition: automated 35 · manual-only 3
- Performance: none — spec states no latency/throughput threshold.

## New infra needed

- none (env-session case uses `page.route` stub; new spec file `tests/e2e/yolo-indicator-layout.spec.ts` reuses the existing docker harness).
