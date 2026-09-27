## 1. Tests first (RED) — `ToolBurstGroup` (L1, see packages/client/src/components/__tests__/ToolBurstGroup.test.tsx)

- [ ] 1.1 Handler gating: running `bash` burst with handlers none / onAbort / both · render · `tool-burst-stop-button` count 0 / 1 / 1 (test-plan #E1)
- [ ] 1.2 onAbort only: running burst · click `tool-burst-stop-button` · `onAbort` 1×, Stop still shown, no Force Stop (test-plan #E2)
- [ ] 1.3 Hidden kind: only running member `bash` with `prefs.toolCalls.bash=false` · render · no stop control and no `tool-burst-header` (test-plan #E3)
- [ ] 1.4 Row gating: expanded burst 2 complete `read` + 1 running `bash` · render · exactly 1 `tool-stop-button` in body, on the running row (test-plan #E4)
- [ ] 1.5 Collapsed pref: running burst with `toolGroupDefaultCollapsed=true` · render · header stop present, `tool-burst-body` absent (test-plan #E5)
- [ ] 1.6 Double Stop: running burst · two clicks on `tool-burst-stop-button` · `onAbort` exactly 1×, Force Stop shown (test-plan #E6)
- [ ] 1.7 Double Force Stop: burst in aborting · two clicks on `tool-burst-force-stop-button` · `onForceKill` exactly 1×, `tool-burst-killing-button` disabled (test-plan #E7)
- [ ] 1.8 Header Stop no toggle: collapsed running burst · click header Stop · `onAbort` 1×, Force Stop shown, body still absent (test-plan #F1)
- [ ] 1.9 Force Stop no toggle: collapsed burst in aborting · click Force Stop · `onForceKill` 1×, Killing disabled, body still absent (test-plan #F2)
- [ ] 1.10 Row→header sharing: expanded 2 complete + 1 running · click row `tool-stop-button` · `onAbort` 1×, header and row both show Force Stop (test-plan #F3)
- [ ] 1.11 Header→row sharing: expanded running burst · click header Stop · running row shows `tool-force-stop-button`, no `tool-stop-button` anywhere (test-plan #F4)
- [ ] 1.12 Survives collapse: expanded burst in killing · collapse then expand via `tool-burst-header` while running · row shows `tool-killing-button`, no Stop (test-plan #F5)
- [ ] 1.13 Reset on completion: burst in aborting · rerender member `complete` (and separately `error`) · no stop or killing control in the burst (test-plan #F6)
- [ ] 1.14 Re-arm: burst went killing → member completes → new running member appended · rerender · header shows `tool-burst-stop-button` (test-plan #F7)
- [ ] 1.15 Outside toggle / valid HTML: running burst expanded + standalone running `ToolCallStep`, both handlers · render · toggle buttons contain 0 descendant `button`/`[role=button]`; every stop control is a `BUTTON` with non-empty `aria-label` (test-plan #F8)
- [ ] 1.16 Keyboard: collapsed running burst · focus stop button and activate via keyboard · stop is `document.activeElement`, `onAbort` 1×, body absent (test-plan #F9)
- [ ] 1.17 Mobile target: running burst under `MobileProvider` mobile true vs false · render · mobile stop class has `min-w-[44px]` + `min-h-[44px]`, desktop has neither (test-plan #F10)
- [ ] 1.18 Header testid regression: running burst with handlers · render + click `tool-burst-header` · exactly one `tool-burst-header`, a `BUTTON`, toggles body (test-plan #F11)
- [ ] 1.19 Kill ignored: `onForceKill` no-op, member stays running · Stop → Force Stop then 3 rerenders · Killing persists, no Stop reappears, `onForceKill` 1× (test-plan #X1)
- [ ] 1.20 i18n fallback: en locale, burst in killing · render · killing `aria-label` is `"Killing process..."`, not `command.killing` (test-plan #X2)

## 2. Tests first (RED) — `ToolCallStep`, `ChatView`, guard

- [ ] 2.1 Standalone parity (see packages/client/src/components/__tests__/ToolCallStep.test.tsx): running `ToolCallStep`, both handlers, no controller · click Stop then Force Stop · `onAbort` 1×, `onForceKill` 1×, `tool-killing-button` disabled, row not expanded (test-plan #F12)
- [ ] 2.2 Controller precedence (see packages/client/src/components/__tests__/ToolCallStep.test.tsx): running `ToolCallStep` with `stopController` in aborting plus own `onAbort` · render · shows `tool-force-stop-button`, own `onAbort` never called (test-plan #F13)
- [ ] 2.3 ChatView wiring (see packages/client/src/components/__tests__/ChatView.custom-groups.test.tsx): `ChatView` with one running `bash` toolResult and `onAbort`/`onForceKill` · render + click burst stop · `tool-burst-stop-button` exists, `onAbort` 1× (test-plan #F14)
- [ ] 2.4 Severity guard (see scripts/__tests__/severity-literal-guard.test.mjs): `ToolStopControl.tsx` holds the red destructive literal · run guard · `GOVERNED` lists `packages/client/src/components/chat/ToolStopControl.tsx` and guard passes with `severity-exempt` marker (test-plan #X3)
- [ ] 2.5 Run the new tests; confirm each fails for the expected reason (missing control / missing testid / not governed).

## 3. Implementation

- [ ] 3.1 Add `components/chat/ToolStopControl.tsx`: `useToolStopState({active,onAbort,onForceKill})` (null unless `active && onAbort`; escalate only with `onForceKill`; state-guarded transitions; reset on `!active`) + presentational `ToolStopControl({controller,testIdPrefix})` with real buttons, `aria-label`, `disabled` Killing, i18n fallbacks, mobile `min-w/h-[44px]`, `severity-exempt` marker on red literal.
- [ ] 3.2 `ToolCallStep.tsx`: remove inline stop spans/state; wrap header in flex div, toggle `<button class="flex-1 min-w-0">` + sibling `<ToolStopControl>`; optional `stopController` prop; call `useToolStopState` unconditionally with `active: status==="running" && !stopController`.
- [ ] 3.3 `ToolBurstGroup.tsx`: props `onAbort?`/`onForceKill?`; call `useToolStopState` BEFORE the `visibleMembers.length === 0` early return; `GroupFrame` flex wrapper with `stopSlot` sibling after the toggle button (keep `tool-burst-header` on the button); `BurstBodyItem` forwards `stopController` to running rows only.
- [ ] 3.4 `ChatView.tsx` burst branch: pass `onAbort`/`onForceKill` to `<ToolBurstGroup>`.
- [ ] 3.5 `scripts/__tests__/severity-literal-guard.test.mjs`: add `ToolStopControl.tsx` to `GOVERNED`.
- [ ] 3.6 Spawn `react-expert` review of the hook + component split (AGENTS.md checkpoint: ≥3 components + new hook).
- [ ] 3.7 All tests in sections 1–2 green; full suite green (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`).

## 4. Docs + closeout

- [ ] 4.1 Update DOX rows: `ToolBurstGroup.tsx.AGENTS.md`, `ToolCallStep.tsx.AGENTS.md`, new `ToolStopControl.tsx` row in `packages/client/src/components/chat/AGENTS.md` (See change: fix-chat-burst-tool-stop).
- [ ] 4.2 `review-code` inline pass on the diff.
- [ ] 4.3 `npm run build && curl -X POST http://localhost:8000/api/restart`.

## 5. Manual QA

- [ ] 5.1 Mobile header fit at 320 px with a long live command: stop visible, title truncates, no overlap (test-plan: manual-only, #F15)
- [ ] 5.2 Live abort: agent runs `sleep 60`; click chat burst Stop; chat card and session-card activity bar clear together (test-plan: manual-only, #F16)
