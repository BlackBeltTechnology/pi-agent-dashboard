# Test Plan — fix-yolo-indicator-overflow

Stage: design   Generated: 2026-10-18 (regenerated after doubt-review cycles 1–3)

Gate decisions applied: G1 row-1 contrast threshold is relative — text ≥ 4.5:1 or ≥ 85% of the
untinted contrast, underline ≥ 3:1, all 18 theme × mode combos (design D7, sidebar-header delta).
Design decisions under test: D1 (both inline indicators removed), D2 (tint + focus-revealed link, no
click handler, non-ticking hook, SPA nav with modified-click passthrough), D3 (composer strip; time
outside the link), D4 (scope tone on strip), D5/D6 (keys + selection), D7 (vehicles, contrast gate).

Sources: proposal.md, design.md (D1–D7), specs/access-grant-yolo/spec.md, specs/sidebar-header/spec.md.

Harness facts: L3 port from `.pi-test-harness.json` (`dashboardPort`), never :18000; YOLO via
`POST /api/access/yolo {durationMinutes, unscoped|base}`, cleared via `DELETE /api/access/yolo`
(`tests/e2e/access-grant-dialog.spec.ts`); language via `localStorage["pi-dashboard-language"]`
(`tests/e2e/lazy-islands.spec.ts`); theme switching as in the theme e2e specs; `formatRemaining` →
`h:mm:ss` when ≥ 3600 s else `m:ss`; Access href `/settings/access`. Read-only surface = archived
session opened from the archive list. Frozen split underlays are `inert` — L3 queries scope to the
live pane. "Legible" = node `scrollWidth ≤ clientWidth`, box inside the strip, no `text-overflow` on it.
"Floor" = shield + time + strip horizontal padding + border.

Testids: bar `header-app-bar` (+ `data-yolo`), bar link `yolo-bar-link`, strip `yolo-composer-strip`
(+ `data-scope`); removed: `yolo-pill`, `yolo-session-indicator`.

Harness exemplars:
- L1 ← `packages/client/src/components/access-grant/__tests__/YoloIndicators.test.tsx`,
  `packages/client/src/components/__tests__/SessionList.yolo-pill.test.tsx`,
  `packages/client/src/components/__tests__/SessionList.question-pill.test.tsx`,
  `packages/client/src/components/__tests__/SessionHeader.yolo.test.tsx`,
  `scripts/__tests__/repo-hygiene.test.mjs` (`i18n-parity exits 0`)
- L3 ← `tests/e2e/access-grant-dialog.spec.ts`, `tests/e2e/mobile-viewport-bound.spec.ts`,
  `tests/e2e/lazy-islands.spec.ts`, `tests/e2e/agent-path-gate.spec.ts`

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | SH tint keeps row-1 height | EP × decision-table (width × lang × scope) | L3 | automated | YOLO scoped and unscoped; en, hu; 375 (drawer opened) / 768 / 1500 × ≥600 | render sidebar; measure `header-app-bar` with YOLO and after `DELETE /api/access/yolo` | heights equal at each width/lang; visible row-1 testids identical |
| E2 | SH height unchanged with link focused | state-transition (focus) | L3 | automated | unscoped YOLO, en, 1500 | Tab until `yolo-bar-link` is focused | link opacity 1 and box non-zero; `header-app-bar` height equals unfocused height |
| E3 | AGY strip single line — session composer | EP × decision-table | L3 | automated | scoped (cwd in scope) and unscoped; en, hu; 375 / 768 / 1500 × ≥600 | open session detail | strip height == line-height + padding + border; strip.right ≤ composer column right; time legible |
| E4 | AGY strip on folder home | EP | L3 | automated | scoped (folder in scope) and unscoped; en, hu; 375 / 1500 | open folder home | E3 assertions hold for the folder-home strip |
| E5 | AGY strip survives height pressure (D3 `shrink-0`) | BVA (pane height) | L3 | automated | unscoped, 768×600; 40-line draft in composer | type draft | strip height still one line box; composer card scrolls |
| E6 | AGY degrade before marker/time | BVA (preferred − 1 px) | L3 | automated | unscoped, hu; strip host width forced to preferred − 1 px | render | sentence node ellipsed (scrollWidth > clientWidth); shield + time legible; one line; right ≤ host right |
| E7 | AGY floor precedence | BVA (== floor) | L3 | automated | unscoped, hu; host width forced to measured floor | render | shield + time legible; one line; right ≤ host right; widths below floor not tested |
| E8 | AGY `hu` ≥ `zh-CN` | EP (locale) | L3 | automated | unscoped, 1500, lang hu then zh-CN | measure sentence span `scrollWidth` | hu ≥ zh-CN |
| E9 | strip time values across ticks | BVA (time width) | L1 | automated | 60-min session at t0, t0+1 s, 1 s remaining | render strip; advance fake clock | time text `1:00:00` / `59:59` / `0:01`; time node classes `shrink-0 tabular-nums` |
| E10 | strip structure pin (D3) | EP | L1 | automated | scoped + unscoped | render strip | wrapper `shrink-0 px-3 pt-2`; strip div classes; link contains shield + sentence (`truncate min-w-0`); time span is a sibling of the link, not inside it |
| E11 | key selection + `∞` (D2b, D5, D6) | decision-table (scope × expiry) | L1 | automated | scoped/unscoped × expiresAt set/null | render hook consumer, bar link, strip | bar `title`, link text, strip sentence + `title` = matching `yolo.coverage*` English; never-expiring time = `∞` with `aria-hidden` + sr-only `yolo.noExpiry`; `*Forever` contains "until the server stops" |
| E12 | scope distinction on strip (D4) | decision-table | L1 | automated | scoped vs unscoped expiring | render strip | unscoped carries `yoloTone(true)` (`border-2 font-bold`), scoped `yoloTone(false)`; both `--severity-warning-*`; `data-scope` differs; no `∞` in an expiring strip |
| E13 | coverage truthful | EP | L1 | automated | scoped + unscoped expiring | render | sentence contains "agent" and "dashboard"; only unscoped contains "every folder"; no `\d+:\d\d` |
| E14 | i18n keys (D5) | EP | L1 | automated | `i18n-hu.ts`, `i18n-zh-CN.ts`, `YoloIndicators.tsx` | import catalogues + read source; `node scripts/i18n-parity.mjs` | 4 `yolo.coverage*` + `yolo.noExpiry` in hu and zh-CN; `yolo.pill`, `pillUnscoped`, `pillTitle`, `pillTitleUnscoped`, `sessionScoped`, `sessionUnscoped` absent from catalogues and source; `yolo.left` / `untilServerStops` still present; parity exits 0 |
| E15 | SH untinted by default | EP | L3 | automated | `DELETE /api/access/yolo` | render sidebar | no `data-yolo`, no `title`, no `yolo-bar-link`; control set unchanged |
| E16 | SH tinted, no visible control added | EP | L1 | automated | active session | render SessionList | bar has `data-yolo`, tint classes, `title`; `yolo-bar-link` is first child with `opacity-0`, `absolute`; every pre-existing row-1 testid present; no `yolo-pill` |
| E17 | SH question pill after TunnelButton | EP (YOLO on/off) | L1 | automated | one open question; YOLO active, then none | render SessionList | `question-pill` index == `tunnel-btn` index + 1 in both states |
| E18 | AGY no header indicator (D1) | EP (desktop + mobile) | L1 | automated | live session, cwd in scope | render SessionHeader desktop and mobile | no `yolo-session-indicator`; no YOLO text in header |
| E19 | AGY read-only surface carries no strip | EP | L3 | automated | unscoped YOLO; archived session opened read-only | open from archive list | no `composer-card`, no `yolo-composer-strip`, no header indicator; bar still tinted |
| E20 | AGY strip outside the card | invariant | L3 | automated | session detail, 1500 | render | strip not contained by `composer-card`; strip.bottom ≤ composer root top |
| E21 | SH contrast relative gate (G1) | decision-table (18 combos) | L3 | automated | YOLO active; each named theme × light/dark | computed colours in browser | `--text-secondary` and `--text-tertiary` on tint ≥ 4.5:1 or ≥ 0.85 × contrast on `--bg-secondary`; underline ≥ 3:1 on tint |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | D2 bar hook must not tick | render-count threshold | L1 | automated | SessionList with active 15-min session, fake timers, React Profiler `onRender` on SessionList | SessionList commits during 5 s of advanced time ≤ 1 (expiry timeout not reached) | 5 s fake time |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | AGY no live region | invariant | L1 | automated | bar, link, strip mounted | walk each → `document.body` | no role ∈ {status, alert, log, timer, marquee}; no `aria-live` ≠ `off` |
| F2 | AGY static across ticks | state-transition (tick) | L1 | automated | 15-min session | `vi.advanceTimersByTime(1000)` | strip time text changes; bar `title`, bar link name, strip link name + `title` byte-identical; strip link name has no `\d+:\d\d` |
| F3 | bar untints at expiry via single timeout | state-transition (expiry) | L1 | automated | 15-min session | advance 15 min | bar loses classes, `title`, `data-yolo`; `yolo-bar-link` and strip unmount |
| F4 | scope change mid-session | state-transition | L1 | automated | scoped → republished unscoped | `yoloStatus.publish` | sentence `coverage` → `coverageUnscoped`; `data-scope` / `data-yolo` flip; strip tone switches |
| F5 | out-of-scope cwd | EP | L1 | automated | scoped; composer cwd outside root | render strip | strip absent; bar still tinted |
| F6 | not dismissible | EP | L1 | automated | active session | query dismiss controls; press Escape | none; signals still rendered |
| F7 | modified click passthrough (D2) | decision-table (button × modifier) | L1 | automated | bar link and strip link | dispatch click with button 0 / 1 and meta / ctrl / shift / alt | primary unmodified → `defaultPrevented` true + route `/settings/access`; any other → `defaultPrevented` false, route unchanged |
| F8 | hover tooltips | EP | L3 | automated | unscoped, en | `hover()` bar background, strip link | `title` == matching coverage sentence; URL unchanged |
| F9 | keyboard path on bar | EP | L3 | automated | 1500 | Tab to `yolo-bar-link`, Enter | URL `/settings/access` without full reload (window marker survives); access card visible |
| F10 | touch path | EP | L3 | automated | `hasTouch: true`, 375 | `tap()` strip sentence; `tap()` strip time | sentence → `/settings/access`, `yolo-access-active` names planes, agent path gate, scope; time tap → URL unchanged |
| F11 | bar click does nothing | invariant | L3 | automated | active, 1500 | click bar background; open ThemePicker and click inside its dropdown padding; open question panel and click its scrim | URL unchanged in every case; dropdown / panel behave as without YOLO |
| F12 | sidebar hidden → strip remains | state-transition | L3 | automated | scoped, cwd in scope; 375 drawer closed; desktop sidebar collapsed | render session | strip visible with time |
| F13 | strip SR reading order | — | — | manual-only | VoiceOver / NVDA on the strip | browse, then focus the link for 5 ticks | [judgment: time read in browse order, not re-announced on focus] |
| F14 | orange YOLO vs worktree chips / working yellow | visual | — | manual-only | session cards working + worktree chip + YOLO on, 3 themes | operator looks | [judgment: hue semantics read correctly] |
| F15 | bar meaning without hover (recorded deviation) | visual | — | manual-only | sighted operator, no hover, YOLO on | operator looks at bar | [judgment: tint + underline recognisable as YOLO given the strip] |
| F16 | ellipsis looks right | visual | — | manual-only | hu, 375 strip | operator looks | [judgment: aesthetics] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | hu catalogue aborted | fault-injection (abort) | L3 | automated | `page.route` aborts `/assets/i18n-hu-*.js` | load hu, unscoped YOLO | English fallbacks; E1 + E3 hold |
| X2 | hu catalogue delayed | fault-injection (delay) | L3 | automated | 3 s delay on hu chunk | load hu | en then hu strings; strip single line and bar height unchanged at both moments |
| X3 | yolo status fetch fails | fault-injection (abort) | L3 | automated | `page.route` 500 on `/api/access/prompts` | load with server YOLO active | no crash; no tint, no strip |
| X4 | auto-allow recorded (regression) | EP | L3 | automated | YOLO + agent path-gate prompt | auto-allow | Access lists agent-path-gate entry answered by yolo; `/api/health` count +1 |

---

## Coverage summary

- Requirements covered: 2 capabilities / 4 MODIFIED requirements — AGY (12 scenarios), SH row-1
  indicator (6), SH two-row layout (via E1/E16), SH open-questions pill (via E17).
- By class: edge 21 · perf 1 · frontend 16 · error 4 (total 42)
- By level: L1 17 · L3 21 · — 4
- By disposition: automated 38 · manual-only 4

## New infra needed

- none (`page.route` stubs; new `tests/e2e/yolo-indicator-layout.spec.ts` on the existing docker harness;
  React Profiler is available in the existing vitest + RTL setup).
