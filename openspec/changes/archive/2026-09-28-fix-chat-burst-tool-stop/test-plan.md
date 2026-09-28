# Test Plan — fix-chat-burst-tool-stop

Stage: design   Generated: 2026-09-27

Requirement under test: `specs/chat-view/spec.md` → "Running burst exposes a shared stop control" (R1), plus design invariants D1 (hook gating + transition guards), D2 (controls outside toggle), D4 (standalone `ToolCallStep` parity), Risk (severity-literal guard).

Visual reference: `mockups/index.html` (states, shared state, arming, mobile). Timer scenarios use `vi.useFakeTimers()` + `FORCE_STOP_ARM_MS`.

Harness exemplars: `packages/client/src/components/__tests__/ToolBurstGroup.test.tsx` (burst render + `MobileProvider` + display-prefs), `packages/client/src/components/__tests__/ToolCallStep.test.tsx` (stop testids, `useMobile` mock), `packages/client/src/components/__tests__/ChatView.custom-groups.test.tsx` (full `ChatView` render).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 gating / D1 | decision-table | L1 | automated | burst with 1 running `bash`; handlers: {none} · {onAbort} · {onAbort,onForceKill} | render | `tool-burst-stop-button` count = 0 · 1 · 1 respectively |
| E2 | R1 gating / D1 | decision-table | L1 | automated | burst with 1 running `bash`, `onAbort` only | click `tool-burst-stop-button` | `onAbort` called 1×; `tool-burst-stop-button` still rendered; `tool-burst-force-stop-button` absent |
| E3 | R1 visible member | EP | L1 | automated | burst whose only running member is `bash` with `prefs.toolCalls.bash=false`, both handlers | render | no element matching `[data-testid^="tool-burst-stop"]`, no `tool-burst-header` |
| E4 | R1 rows | EP | L1 | automated | expanded burst: 2 `read` `complete` + 1 `bash` `running`, both handlers | render | exactly 1 `tool-stop-button` in `tool-burst-body`, inside the running row; completed rows contain 0 |
| E5 | R1 collapsed | decision-table | L1 | automated | burst with 1 running `bash`, `toolGroupDefaultCollapsed=true`, both handlers | render | `tool-burst-stop-button` present; `tool-burst-body` absent |
| E6 | R1 double-click safety | BVA (click count) | L1 | automated | running burst, both handlers | 2 clicks within 50 ms on the SAME held button node (not re-queried), fake timers | `onAbort` 1×; `onForceKill` 0×; `tool-burst-arming-button` rendered and `disabled` |
| E7 | D1 guard | BVA (click count) | L1 | automated | running burst in `aborting` | click `tool-burst-force-stop-button` 2× | `onForceKill` called exactly 1×; `tool-burst-killing-button` rendered with `disabled` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R1 header stop / arm / no toggle | state-transition idle→arming→aborting | L1 | automated | collapsed running burst, both handlers, fake timers | click `tool-burst-stop-button`; advance 599 ms; advance 1 ms | `onAbort` 1×; at 599 ms `tool-burst-arming-button` disabled; at 600 ms `tool-burst-force-stop-button` enabled; `tool-burst-body` absent throughout |
| F2 | R1 aborting→killing / no toggle | state-transition | L1 | automated | collapsed running burst in `aborting` | click `tool-burst-force-stop-button` | `onForceKill` 1×; `tool-burst-killing-button` has `disabled`; `tool-burst-body` still absent |
| F3 | R1 shared state (row→header) | state-transition | L1 | automated | expanded burst: 2 complete + 1 running, both handlers, fake timers | click row `tool-stop-button`; advance 600 ms | `onAbort` 1×; before: header `tool-burst-arming-button` + row `tool-arming-button`; after: header `tool-burst-force-stop-button` + row `tool-force-stop-button` |
| F4 | R1 shared state (header→row) | state-transition | L1 | automated | expanded running burst, both handlers, fake timers | click `tool-burst-stop-button`; advance 600 ms | running row renders `tool-force-stop-button`; no `tool-stop-button` anywhere |
| F5 | R1 survives collapse | state-transition | L1 | automated | expanded running burst in `killing` | click `tool-burst-header` (collapse), click again (expand); member still `running` | running row renders `tool-killing-button`; no `tool-stop-button` |
| F6 | R1 reset on completion | state-transition (running→complete / →error) | L1 | automated | running burst in `arming` (fake timers); separate case in `aborting` | rerender with member `toolStatus:"complete"` (and `"error"`); advance 1000 ms | no `[data-testid*="stop-button"]`, `*arming-button`, `*killing-button` in the burst after the advance |
| F7 | R1 reset + re-arm | state-transition (complete→running) | L1 | automated | burst went `killing` → member completes → a new running member appended to same burst | rerender | header renders `tool-burst-stop-button` (state back to `idle`) |
| F8 | R1 outside toggle / valid HTML | invariant | L1 | automated | running burst (expanded) with both handlers; standalone running `ToolCallStep` with both handlers | render | `tool-burst-header` and the `ToolCallStep` toggle button contain 0 descendant `button` / `[role=button]`; all stop controls are `BUTTON` elements with non-empty `aria-label` |
| F9 | R1 keyboard | invariant | L1 | automated | collapsed running burst, both handlers | `.focus()` the stop button, fire `keyDown Enter` / `click` via keyboard activation | `document.activeElement` is the stop button; `onAbort` 1×; body still absent |
| F10 | R1 target size | EP (mobile vs desktop) | L1 | automated | running burst under `MobileProvider` mobile=true; same under mobile=false | render | mobile: header + row stop className contains `min-w-[44px]` and `min-h-[44px]`; desktop: contains `min-w-6` and `min-h-6`, not `44px` |
| F11 | R1 header testid kept | invariant (regression) | L1 | automated | running burst with both handlers | render | exactly 1 `tool-burst-header`, it is a `BUTTON`, and clicking it toggles `tool-burst-body` |
| F12 | D4 standalone parity | state-transition | L1 | automated | standalone `ToolCallStep` `status:"running"`, both handlers, no `stopController`, fake timers (updates existing case `ToolCallStep.test.tsx:549`) | click `tool-stop-button`; assert `tool-arming-button` disabled; advance `FORCE_STOP_ARM_MS`; click `tool-force-stop-button` | `onAbort` 1×, `onForceKill` 1×, `tool-killing-button` disabled; row not expanded by either click |
| F13 | D4 controller precedence | invariant | L1 | automated | `ToolCallStep` `status:"running"` given `stopController` in `aborting` AND own `onAbort` | render | renders `tool-force-stop-button` (controller state wins); own `onAbort` never called |
| F17 | R1 label per viewport | EP (mobile vs desktop) | L1 | automated | running burst, both handlers | render desktop; render mobile | desktop: header stop `textContent` contains `Stop`; row stop has no text; mobile: header stop has no visible text; `aria-label` non-empty on both |
| F18 | R1 shape per state (1.4.1) | decision-table | L1 | automated | `ToolStopControl` rendered in each of idle/arming/aborting/killing | render | svg `path[d]` equals `mdiStop` / `mdiTimerSand` / `mdiAlert` / `mdiLoading` (4 distinct); arming `aria-label` === `"Stopping…"` |
| F14 | Wiring (ChatView → burst) | integration | L1 | automated | `ChatView` with one running `bash` toolResult message and `onAbort`/`onForceKill` props | render; click the burst stop button | a `tool-burst-stop-button` exists; `onAbort` spy called 1× |
| F15 | Mobile header fit | visual/subjective | — | manual-only | running burst with long live command, 320 px viewport | human looks | [judgment: glyph-only stop fully visible, live command readable (≥ 60 px), no wrap/overlap — compare against `mockups/index.html` Mobile 375 — no automatable observable in jsdom] |
| F16 | End-to-end abort | live runtime | — | manual-only | real session running `sleep 60` via agent bash tool | click chat burst Stop | [judgment: tool ends in chat card and session-card activity bar together; requires live pi session] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Risk: kill ignored | fault-injection (abort ignored) | L1 | automated | `onForceKill` spy is a no-op (tool keeps `running`) | click Stop → Force Stop, then rerender with member still `running` 3× | header stays `tool-burst-killing-button` (disabled); no `tool-burst-stop-button` re-appears; `onForceKill` 1× total |
| X2 | Risk: i18n fallback | fault-injection (missing key) | L1 | automated | active locale lacks `command.killing` (en source) | render burst in `killing` | killing button `aria-label` === `"Killing process..."` (not the raw key `command.killing`) |
| X3 | Token fidelity | invariant | L1 | automated | `ToolStopControl` in each state; source of `ToolCallStep.tsx` | render; read source | idle class contains `--severity-error-fg`; aborting contains `--severity-warning-fg`; no class matches `/(red|orange)-\d/` in any state; `ToolCallStep.tsx` contains no `severity-exempt` |
| X4 | Timer leak | fault-injection (unmount mid-arm) | L1 | automated | running burst in `arming`, `console.error` spy, fake timers | unmount; advance 1000 ms | `onForceKill` 0×; `console.error` not called |

---

## Coverage summary

- Requirements covered: R1 (all 8 spec scenarios) + D1, D2, D4, design risks (kill ignored, i18n, tokens, timer leak)
- Scenarios by class: edge 7 · perf 0 · frontend 18 · error 4
- Scenarios by level: L1 27 · L2 0 · L3 0
- Scenarios by disposition: automated 27 · manual-only 2

## New infra needed

- none
