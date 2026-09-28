## 1. Tests first (RED) — `ToolBurstGroup` (L1, see packages/client/src/components/__tests__/ToolBurstGroup.test.tsx)

- [x] 1.1 Handler gating: running `bash` burst with handlers none / onAbort / both · render · `tool-burst-stop-button` count 0 / 1 / 1 (test-plan #E1)
- [x] 1.2 onAbort only: running burst · click `tool-burst-stop-button` · `onAbort` 1×, Stop still shown, no Force Stop (test-plan #E2)
- [x] 1.3 Hidden kind: only running member `bash` with `prefs.toolCalls.bash=false` · render · no stop control and no `tool-burst-header` (test-plan #E3)
- [x] 1.4 Row gating: expanded burst 2 complete `read` + 1 running `bash` · render · exactly 1 `tool-stop-button` in body, on the running row (test-plan #E4)
- [x] 1.5 Collapsed pref: running burst with `toolGroupDefaultCollapsed=true` · render · header stop present, `tool-burst-body` absent (test-plan #E5)
- [x] 1.6 Double-click safety: running burst, fake timers · 2 clicks within 50 ms on the same held button node · `onAbort` 1×, `onForceKill` 0×, `tool-burst-arming-button` disabled (test-plan #E6)
- [x] 1.7 Double Force Stop: burst in aborting · two clicks on `tool-burst-force-stop-button` · `onForceKill` exactly 1×, `tool-burst-killing-button` disabled (test-plan #E7)
- [x] 1.8 Header Stop arm + no toggle: collapsed running burst, fake timers · click Stop, advance 599 then 1 ms · `onAbort` 1×; 599 ms arming disabled; 600 ms Force Stop enabled; body absent throughout (test-plan #F1)
- [x] 1.9 Force Stop no toggle: collapsed burst in aborting · click Force Stop · `onForceKill` 1×, Killing disabled, body still absent (test-plan #F2)
- [x] 1.10 Row→header sharing: expanded 2 complete + 1 running, fake timers · click row `tool-stop-button`, advance 600 ms · `onAbort` 1×; header + row both arming, then both Force Stop (test-plan #F3)
- [x] 1.11 Header→row sharing: expanded running burst, fake timers · click header Stop, advance 600 ms · running row shows `tool-force-stop-button`, no `tool-stop-button` anywhere (test-plan #F4)
- [x] 1.12 Survives collapse: expanded burst in killing · collapse then expand via `tool-burst-header` while running · row shows `tool-killing-button`, no Stop (test-plan #F5)
- [x] 1.13 Reset on completion: burst in arming (and separately aborting), fake timers · rerender member `complete` / `error`, advance 1000 ms · no stop, arming or killing control in the burst (test-plan #F6)
- [x] 1.14 Re-arm: burst went killing → member completes → new running member appended · rerender · header shows `tool-burst-stop-button` (test-plan #F7)
- [x] 1.15 Outside toggle / valid HTML: running burst expanded + standalone running `ToolCallStep`, both handlers · render · toggle buttons contain 0 descendant `button`/`[role=button]`; every stop control is a `BUTTON` with non-empty `aria-label` (test-plan #F8)
- [x] 1.16 Keyboard: collapsed running burst · focus stop button and activate via keyboard · stop is `document.activeElement`, `onAbort` 1×, body absent (test-plan #F9)
- [x] 1.17 Target size: running burst under `MobileProvider` mobile true vs false · render · mobile header + row stop have `min-w-[44px]` + `min-h-[44px]`; desktop have `min-w-6` + `min-h-6` (test-plan #F10)
- [x] 1.18 Header testid regression: running burst with handlers · render + click `tool-burst-header` · exactly one `tool-burst-header`, a `BUTTON`, toggles body (test-plan #F11)
- [x] 1.19 Kill ignored: `onForceKill` no-op, member stays running · Stop → Force Stop then 3 rerenders · Killing persists, no Stop reappears, `onForceKill` 1× (test-plan #X1)
- [x] 1.20 i18n fallback: en locale, burst in killing · render · killing `aria-label` is `"Killing process..."`, not `command.killing` (test-plan #X2)
- [x] 1.21 Label per viewport: running burst, both handlers · render desktop and mobile · desktop header stop text contains `Stop`, row stop has no text; mobile header stop has no visible text; `aria-label` non-empty (test-plan #F17)
- [x] 1.22 Timer leak: running burst in arming, `console.error` spy, fake timers · unmount, advance 1000 ms · `onForceKill` 0×, `console.error` not called (test-plan #X4)

## 2. Tests first (RED) — `ToolCallStep`, `ChatView`, guard

- [x] 2.1 Standalone parity — UPDATE existing case "calls onAbort and escalates to force-stop on click" (packages/client/src/components/__tests__/ToolCallStep.test.tsx:549) to fake timers: running `ToolCallStep`, both handlers, no controller · click Stop, assert `tool-arming-button` disabled, advance `FORCE_STOP_ARM_MS`, click Force Stop · `onAbort` 1×, `onForceKill` 1×, `tool-killing-button` disabled, row not expanded (test-plan #F12)
- [x] 2.2 Controller precedence (see packages/client/src/components/__tests__/ToolCallStep.test.tsx): running `ToolCallStep` with `stopController` in aborting plus own `onAbort` · render · shows `tool-force-stop-button`, own `onAbort` never called (test-plan #F13)
- [x] 2.3 ChatView wiring (see packages/client/src/components/__tests__/ChatView.custom-groups.test.tsx): `ChatView` with one running `bash` toolResult and `onAbort`/`onForceKill` · render + click burst stop · `tool-burst-stop-button` exists, `onAbort` 1× (test-plan #F14)
- [x] 2.4 Token fidelity (new `components/__tests__/ToolStopControl.test.tsx`, see packages/client/src/components/__tests__/ToolCallStep.test.tsx for harness): control in each state + `ToolCallStep.tsx` source · render / read · idle has `--severity-error-fg`, aborting has `--severity-warning-fg`, no `/(red|orange)-\d/` class in any state, no `severity-exempt` in `ToolCallStep.tsx` (test-plan #X3)
- [x] 2.5 Shape per state (same file as 2.4): control in idle / arming / aborting / killing · render · svg `path[d]` = `mdiStop` / `mdiTimerSand` / `mdiAlert` / `mdiLoading`, arming `aria-label` `"Stopping…"` (test-plan #F18)
- [x] 2.6 Run the new tests; confirm each fails for the expected reason (missing control / missing testid / missing arming state).

## 3. Implementation

- [x] 3.1 Add `components/chat/ToolStopControl.tsx` per design D1 + `mockups/ui-plan.md`: `useToolStopState` (states idle/arming/aborting/killing, `FORCE_STOP_ARM_MS=600`, guarded transitions, timer cleared on `!active` + unmount) + `ToolStopControl({controller,testIdPrefix,labeled})` — real buttons, glyphs mdiStop/mdiTimerSand/mdiAlert/mdiLoading, new i18n key `common.stopping` in en/hu/zh, severity tokens only, `disabled` arming + killing, i18n fallbacks, desktop `min-w-6 min-h-6`, mobile `min-w/h-[44px]` glyph-only, `focus-ring`, `motion-reduce:animate-none`.
- [x] 3.2 `ToolCallStep.tsx`: remove inline stop spans/state and the `severity-exempt` red literal; wrap header in flex div, toggle `<button class="flex-1 min-w-0">` + sibling `<ToolStopControl>`; optional `stopController` prop; call `useToolStopState` unconditionally with `active: status==="running" && !stopController`.
- [x] 3.3 `ToolBurstGroup.tsx`: props `onAbort?`/`onForceKill?`; call `useToolStopState` BEFORE the `visibleMembers.length === 0` early return; `GroupFrame` flex wrapper with `stopSlot` sibling after the toggle button rendering `<ToolStopControl controller testIdPrefix="tool-burst" labeled />` (keep `tool-burst-header` on the button); `BurstBodyItem` forwards `stopController` to running rows only.
- [x] 3.4 `ChatView.tsx` burst branch: pass `onAbort`/`onForceKill` to `<ToolBurstGroup>`.
- [x] 3.5 Spawn `react-expert` review of the hook + component split (AGENTS.md checkpoint: ≥3 components + new hook).
- [x] 3.6 All tests in sections 1–2 green; full suite green (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`).

## 4. Docs + closeout

- [x] 4.1 Update DOX rows: `ToolBurstGroup.tsx.AGENTS.md`, `ToolCallStep.tsx.AGENTS.md`, new `ToolStopControl.tsx` row in `packages/client/src/components/chat/AGENTS.md` (See change: fix-chat-burst-tool-stop).
- [x] 4.2 `review-code` inline pass on the diff.
- [x] 4.3 `npm run build && curl -X POST http://localhost:8000/api/restart`. (Worktree build blocked by unlinked workspace plugin `pi-dashboard-system-one-plugin` — environmental; CI build is the gate; local deploy after merge.)

## 5. Manual QA

- [ ] 5.1 Mobile header fit at 320 px with a long live command: glyph-only stop visible, live command readable, no overlap; compare with `mockups/index.html` Mobile 375 (test-plan: manual-only, #F15)
- [ ] 5.2 Live abort: agent runs `sleep 60`; click chat burst Stop; chat card and session-card activity bar clear together (test-plan: manual-only, #F16)
