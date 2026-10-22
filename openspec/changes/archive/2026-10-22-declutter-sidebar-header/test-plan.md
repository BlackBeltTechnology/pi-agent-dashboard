# Test Plan — declutter-sidebar-header

Stage: design   Generated: 2026-10-22

Hard gate: no unfillable Triple. Values not stated in the spec deltas are anchored to current code, which the change keeps:
- a failed `/api/tunnel-status` fetch keeps the last known state (`TunnelButton.tsx:50-64`);
- the pending badge shows the raw count (`TunnelButton.tsx:121`);
- Remote access refetches status and opens the landing view (`TunnelButton.tsx:96-100`).

Levels: L1 = vitest (`packages/client/src/**/__tests__`); L3 = Playwright vs the docker harness (`tests/e2e/*.spec.ts`, port from `.pi-test-harness.json`). Container-query and layout-width rows are L3 because jsdom has no layout.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | sidebar-header: Two-row header layout (Row 1 contains app-level controls) | decision-table | L1 | automated | (a) browser launch, 2 open questions, update available; (b) Electron launch, no questions, runtime update; (c) browser, nothing pending | render SessionList with App `headerExtra` | row-1 focusables in DOM order: (a) home, `discord-btn`, `theme-picker-trigger`, `focus-toggle-btn`, questions pill, `pi-update-badge`, `connection-chip`, `settings-btn`; (b) the same, without the questions pill and with the runtime badge instead of `pi-update-badge`; (c) no pill and no badge; the divider is `aria-hidden` in all three |
| E2 | sidebar-header: Row 1 contains no standalone ThemeToggle / TunnelButton / InstallButton | EP | L1 | automated | installable PWA, menu closed | render | `header-app-bar` contains no `theme-toggle`, `tunnel-btn` or `install-btn`; `theme-toggle` appears only after `theme-picker-trigger` is clicked |
| E3 | sidebar-header: Row 1 stays on one line in the common state | BVA | L3 | automated | connected, update available, no question, no waiting device, server label 34 chars | set sidebar width 279 / 280 / 320 / 440 / 500 px | at 280/320/440/500 every row-1 child has the same `offsetTop`; at 279 no child's rect extends past `header-app-bar`'s right edge |
| E4 | sidebar-header: Worst-case state never clips | BVA | L3 | automated | 2 open questions, update, server offline, tunnel `failed`, 1 waiting device | set sidebar width 180 / 280 / 399 / 400 / 500 px | at every width each row-1 child rect is inside the `header-app-bar` rect; at 400 and 500 every child has the same `offsetTop` |
| E5 | sidebar-header: connection chip name + offline breakpoint | BVA | L3 | automated | offline, server label 34 chars | header container width 399 vs 400 px | 399: name hidden, offline glyph visible, "Offline" text hidden; 400: name and "Offline" visible, glyph hidden |
| E6 | sidebar-header: Remote-access states differ by shape | EP | L1 | automated | indicator tone `local`, `network`, `internet`, `partial`, `failed` | render chip | `local`/`network`: no tone glyph; the other three render three different `path` `d` values; `aria-label` contains "remote access internet" / "partial" / "failed" respectively |
| E7 | sidebar-header: Waiting device is visible without opening the menu | BVA | L1 | automated | pending pairing count 0, 1, 12 | render chip, open menu | 0: no `tunnel-btn-badge`; 1: badge text `1`, Remote access sublabel contains "1 device waiting"; 12: badge `12`, sublabel "12 devices waiting" |
| E8 | sidebar-header: Conditional controls still conditional (Install) | decision-table | L1 | automated | `canInstall`×`isInstalled` = (t,f), (t,t), (f,f), (f,t) | open connection menu | `install-btn` menuitem present only for (t,f) |
| E9 | session-filtering: Funnel counts its own filters | decision-table | L1 | automated | Include archive × Show hidden ∈ {off,on}², plus one active tag filter | render funnel | badge absent / 1 / 1 / 2; `aria-label` "Filters, 0 on" … "Filters, 2 on"; the tag filter never changes the badge |
| E10 | session-search: AND composition through the scoped box | decision-table | L1 | automated | folders `/w/dashboard` (session "Refactor auth"), `/w/dashboard` ("fix css"), `/w/other` ("auth flow"), all pinned | scope Folders type `dashboard`, scope Sessions type `auth` | only `/w/dashboard` visible with only "Refactor auth"; box value `auth`; `search-chip-switch` text `dashboard` |
| E11 | session-search: Switching scope keeps the other query | state-transition | L1 | automated | Folder query `dashboard`, Session query empty, scope Folders | click `search-scope-sessions` | input testid `session-search-input`, value empty, aria-label "Search sessions across folders"; folder filter still applied (`/w/other` hidden) |
| E12 | session-search: chip switches scope / clears its query | state-transition | L1 | automated | scope Sessions, Session `auth`, Folder `dashboard` | (a) click `search-chip-switch`; (b) instead click `search-chip-clear` | (a) scope Folders, input value `dashboard`, chip shows `auth`, input focused; (b) Folder query empty, chip gone, Session `auth` unchanged, input focused |
| E13 | session-search: Session-search-only mode shows pinned folders only | EP | L1 | automated | pinned `/w/a` with "auth x", unpinned `/w/b` alive with "auth y" | (a) Session `auth` only; (b) then Folder `b` | (a) only `/w/a` visible; (b) `/w/b` visible with "auth y" |
| E14 | session-search: Auto-expand collapsed folders when a filter is active | state-transition | L1 | automated | `/w/a` collapsed, Session query empty | type `x` in scope Sessions, then clear via the box; repeat with a Folder query cleared via `search-chip-clear` | expanded while any query is non-empty; collapsed again once both are empty |
| E15 | session-search: Opening a question session resets search | state-transition | L1 | automated | scope Folders, Folder `dash`, Session `auth`, tag filter `wip` active, 1 open question | open the session from the questions panel | both queries empty, tag filter cleared, `search-scope-sessions` `aria-pressed=true` |
| E16 | sidebar-header: Appearance popover (mode + palette) | state-transition | L1 | automated | mode Dark, palette Base | open `theme-picker-trigger`; click `theme-light`; click `theme-option-nord`; remount | after Light: `theme-light` `aria-pressed=true`, dropdown still open; after Nord: dropdown closed, focus on `theme-picker-trigger`; after remount: Nord active |
| E17 | session-search: Substring match (archive search via funnel toggle) | BVA | L1 | automated | Include archive on (in funnel); session query of 2 then 3 chars | type | 2 chars: no archive-search request; 3 chars: exactly one debounced request; Include archive off + 3 chars: no request |
| E18 | design D6 / theme-system: Card pill surfaces paint colour only through tokens | EP | L1 | automated | `SessionList.tsx` after the change | run `card-pill-surfaces-no-literals.test.ts` | all four regions located (`ToggleButton`, add-to-workspace, `search-include-archive`, pinned indicator); no literal match |
| E19 | session-filtering: Show hidden toggle in the funnel | state-transition | L1 | automated | 2 hidden sessions, Show hidden off | open funnel, click `show-hidden-toggle` | `aria-pressed=true`; both hidden sessions render at reduced opacity with resume/fork; no unhide button |
| E20 | session-list-filters: Filter row carries no pin-folder button | EP | L1 | automated | `onPinDirectory` provided | render | no `pin-dir-dialog-btn` and no "Add folder" text in `header-filter-bar` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | sidebar-header: Access items are reachable by keyboard | state-transition | L1 | automated | 2 servers, installable PWA, menu open | ArrowDown ×5, then Home, then End | focus order: server1, server2, Manage servers…, `tunnel-btn`, `install-btn`; Home → server1; End → `install-btn`; the Access label never receives focus |
| F2 | sidebar-header: Header popovers are keyboard operable (Escape) | state-transition | L1 | automated | each of Appearance, connection menu, funnel open | press Escape | panel unmounted; `document.activeElement` is that popover's trigger |
| F3 | sidebar-header: Keyboard open focuses inside | state-transition | L1 | automated | mode System | focus trigger + Enter on Appearance, funnel, connection chip | focus on `theme-system`, on the Include archive toggle, on the first server item |
| F4 | sidebar-header: Remote access item opens the existing dialog | state-transition | L1 | automated | fetch mock for `/api/tunnel-status`; no stored run | open menu, Enter on `tunnel-btn` | one status fetch; menu closed; `gateway-dialog` on its landing view, focus inside it; close → focus on `connection-chip` |
| F5 | design D3: focus return with two chip instances | state-transition | L1 | automated | two `ServerSelector` instances (desktop + overlay) sharing App's dialog | open dialog from instance B, unmount/hide B, close dialog; then repeat with both hidden | focus on instance A's `connection-chip`; with none visible, no error and focus on `body` |
| F6 | design D3: single remote-access owner + resume | state-transition | L1 | automated | fake timers; a fresh stored run; `resolvedBindHost` changes `null` → `0.0.0.0` | mount App-level hook, advance 60 s | exactly 2 interval fetches + 1 initial (one poller); the dialog opens once with `initialRun` = the stored run; storage key removed |
| F7 | sidebar-header: Narrowest sidebar keeps popovers on-screen | BVA | L3 | automated | viewport 375×667, sidebar 180 px | open Appearance, connection menu, funnel in turn | each panel's bounding rect satisfies `left ≥ 0`, `right ≤ 375`, `top ≥ 0`, `bottom ≤ 667` |
| F8 | sidebar-header: Short viewport (Appearance) | BVA | L3 | automated | viewport height 480 px | open Appearance | panel rect inside the viewport; panel `scrollHeight > clientHeight` or its full content is visible |
| F9 | sidebar-header: The tint does not change row 1's height (YOLO, modified baseline) | state-transition | L3 | automated | YOLO active vs inactive; widths 375 (drawer), 768, 1500; `en` and `hu` | render, then focus the YOLO link | row-1 height equal tinted vs untinted at each width; YOLO link is the first focusable in row 1, before `discord-btn` |
| F10 | sidebar-header: Install selection returns focus | state-transition | L1 | automated | installable PWA, `prompt` spy | open menu, Enter on `install-btn` | menu closed; focus on `connection-chip`; `prompt` called once |
| F11 | sidebar-header: Remote access item opens the existing dialog (harness) | state-transition | L3 | automated | harness dashboard with zrok provider configured | `openConnectionMenu(page)`, click `tunnel-btn` | `gateway-dialog` visible on its landing view; the existing zrok-v2 flow assertions pass unchanged after the open step |
| F12 | sidebar-header: grouping reads clearly in every theme | visual/subjective | — | manual-only | row 1 + three open popovers in Base dark, Base light, Nord | operator looks | [judgment: brand / tools / status groups read as distinct; no visual crowding — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | design D3: tunnel-status fetch failure | fault-injection (abort) | L1 | automated | first poll returns `internet` tone, next 2 polls reject (network error) and return HTTP 500 | advance timers 60 s | chip keeps the `internet` glyph; no thrown error / unhandled rejection; polling continues (third fetch issued) |
| X2 | sidebar-header: Disconnected is not colour-only | fault-injection (abort) | L1 | automated | WebSocket status flips `connected` → `disconnected` | re-render chip | `aria-label` matches `/Server: .+, offline/`; the "Offline" text node and the offline glyph node are both rendered (breakpoint visibility is E5) |
| X3 | design D3: tunnel-status fetch delay | fault-injection (delay) | L1 | automated | `/api/tunnel-status` resolves after 5 s | Enter on `tunnel-btn` | dialog opens only after the refetch settles (today's `handleClick` awaits it); menu already closed; no double-open on a second Enter |

---

## Coverage summary

- Requirements covered: 22/22. Delta requirements: sidebar-header ×7, session-search ×5, session-filtering ×1, session-sidebar ×2 (via E1 order + existing PiLogo tests), session-list-decomposition (removal, no test), session-list-filters ×1. Design invariants D3/D6 are also covered.
- Scenarios by class: edge 20 · perf 0 · frontend 12 · error 3
- Scenarios by level: L1 27 · L2 0 · L3 7 · — 1
- Scenarios by disposition: automated 34 · manual-only 1

## New infra needed

- None. L3 rows extend the existing docker harness. E3/E4/E5/F7/F8 go in one new spec, `tests/e2e/sidebar-header-fit.spec.ts`; F9 extends `yolo-indicator-layout.spec.ts`; F11 extends `zrok-v2-tunnel.spec.ts`.
