# Test Plan — fix-long-session-ux-degradation

Stage: design   Generated: 2025-06-07

No clarification gate fired: every Triple slot resolved from the delta specs +
design.md. The one tunable (`IDLE_FX_DELAY_MS = 5000`) is stated in design.md
D8, and every performance threshold is stated in proposal.md §7 / §5 as a
measured baseline. Where a threshold exists but this repo has no harness that
can assert it (Chrome tracing), the row is routed `manual-only` rather than
given an invented automatable proxy — see *New infra needed*.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | drag-body-style — overrides scoped to drag | state-transition | L1 | automated | mounted `useBodyDragStyle` consumer, body styles empty | `beginBodyDrag("col-resize")` | `document.body.style.cursor === "col-resize"` AND `userSelect === "none"` |
| E2 | drag-body-style — cleared on drag end | state-transition | L1 | automated | consumer mid-drag after `beginBodyDrag` | `endBodyDrag()` | both `cursor` and `userSelect` are back to `""` |
| E3 | drag-body-style — cleared on unmount mid-drag | state-transition (illegal edge) | L1 | automated | consumer mid-drag, no `mouseup` delivered | unmount the component | both properties `""`; document is selectable |
| E4 | drag-body-style — idle unmount touches nothing | state-transition (illegal edge) | L1 | automated | consumer mounted, never began a drag; body pre-set to `cursor:"crosshair"` | unmount | `cursor` still `"crosshair"` (hook did not clear a value it never set) |
| E5 | drag-body-style — two-instance isolation | decision-table | L1 | automated | two consumers mounted; A mid-drag, B idle | unmount B | A's `cursor`/`userSelect` overrides still applied |
| E6 | drag-body-style — StrictMode double-invoke | state-transition (illegal edge) | L1 | automated | consumer rendered under `<StrictMode>` (double mount/unmount) | mount, begin drag | overrides applied exactly once; no clear fired by the discarded first mount |
| E7 | drag-body-style — `endBodyDrag` idempotent | EP (invalid partition) | L1 | automated | consumer that never began, or already ended | call `endBodyDrag()` twice | no throw; body styles unchanged from before the calls |
| E8 | drag-body-style — all three draggers delegate | decision-table | L1 | automated | each of `ResizableSidebar`, `SplitDivider`, `ResizableTreePanel` mounted | `mousedown` on the handle, then unmount before `mouseup` | for each: body left selectable, no residual cursor; no `document.body.style` write remains in the three source files |
| E9 | content-copy — success path | EP (valid) | L1 | automated | `navigator.clipboard.writeText` resolves | click `CopyButton` | ✓ indicator shown; no hidden textarea created or left in the DOM |
| E10 | incremental-event-sync — selector yields running only | EP | L1 | automated | session state with 3 `running` and 7 terminal (`complete`/`error`/`elided`) tool rows, all still present in `toolCalls` | call `selectActiveToolKeys(states)` | returns exactly the 3 running `${sessionId}:${toolCallId}` keys |
| E11 | incremental-event-sync — tick discards non-running keys | state-transition | L1 | automated | bookkeeping populated for 10 rows; 7 then reach a terminal state (rows remain present) | one reconcile tick | `lastAttemptRef`/`count404Ref` retain only the 3 running keys |
| E12 | incremental-event-sync — running row keeps backoff | state-transition | L1 | automated | a running row with last-attempt `T` and 404 count `2`, alongside terminal rows being discarded | one reconcile tick | that row's last-attempt is still `T` and its 404 count is still `2` |
| E13 | mobile-resilience — shell root claims no viewport unit | decision-table | L1 | automated | `MobileShell` rendered | inspect root element classes | root has `w-full flex-1 min-h-0`; contains neither `w-screen` nor `h-[100dvh]` |
| E14 | chat-scroll-lock — sub-pixel tolerance | BVA | L1 | automated | pin snapshot recorded at `scrollTop 5000.0`; content has grown | induced event reports `scrollTop 5000.4` | treated as a measurement clamp — follow preserved |
| E15 | chat-scroll-lock — just outside tolerance releases | BVA (just-above-max) | L1 | automated | same snapshot at `5000.0`, content grown | induced event reports `scrollTop 5005` | NOT treated as a clamp — falls through, follow released |
| E16 | chat-scroll-lock — empty/zero-height pin guard | BVA (min) | L1 | automated | pin written against an empty transcript (`scrollHeight === clientHeight`, achieved `scrollTop 0`) | induced event dispatches | clamp branch does NOT apply (the "landed with real content" clause fails) |
| E17 | ui-animation-energy — idle delay boundary | BVA | L1 | automated | `useIdleFx` mounted, fake timers, `IDLE_FX_DELAY_MS = 5000` | advance 4999 ms, then 1 ms more | no `fx-idle` at 4999 ms; `fx-idle` present at 5000 ms |
| E18 | ui-animation-energy — non-activity events | decision-table | L1 | automated | `useIdleFx` mounted, fake timers | dispatch `pointermove` and `scroll` repeatedly, then advance past the delay | `fx-idle` IS applied — neither event counts as activity |
| E19 | ui-animation-energy — each activity event clears | decision-table | L1 | automated | `fx-idle` applied | dispatch each of `pointerdown`, `wheel`, `keydown`, `touchstart`, `focusin` (capture, from a stopped-propagation subtree) | each one clears `fx-idle` and restarts the delay |
| E20 | ui-animation-energy — decorative animations stay non-exempt | decision-table | L1 | automated | markup carrying `animate-pulse` and `.tool-group-spin-pulse` | apply `fx-idle` | neither class is matched by an exemption rule (both remain subject to the pause) |
| E21 | chat-selection-preservation — narrowed context type | static analysis | ci | automated | `ToolContext.session` re-declared as `session?: { subagents: … }` | run the workspace typecheck | `tsc` clean across every workspace importing `ToolContext`; `SessionStateLike` still structurally matches |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | incremental-event-sync — bookkeeping bounded | soak (in-process) | L1 | automated | 5 000 tool rows created, each run→terminal, all remaining present in `toolCalls`; ticks driven throughout | retained `lastAttemptRef` + `count404Ref` entry count equals the currently-running row count (≤ 10), NOT 5 000 | full simulated run |
| P2 | chat-selection-preservation — churn under load | soak (in-process) | L1 | automated | selected transcript rendered; background session emits state updates at ~60/s for ≥ 2 s | child-list mutations observed in the selected transcript's markdown subtree = 0 (baseline repro: 26 from a single event) | 2 s stream |
| P3 | ui-animation-energy — idle CPU collapse | trace threshold | — | manual-only | visible dashboard, ≥ 1 background session streaming, no input, no in-flight spinner | Chrome trace `CrGpuMain` share of a core drops from ~10 % toward ~1.6 %; background-stream stripes cost falls from 3 268 ms to near-zero | ≥ 13 s strict idle |
| P4 | chat-scroll-lock — long-session settle | state-convergence | L3 | automated | harness session with a transcript large enough that rows measure in after the pin (baseline repro: `scrollHeight` 21 136 → 39 578) | open the session | view comes to rest within one viewport of the bottom (baseline defect: `scrollTop 25521 / max 38909`), scroll-to-bottom button hidden |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | chat-scroll-lock — clamp holds the follow | state-transition | L1 | automated | bottom-pin written and clamped to the then-current extent; browser-faithful `setScrollPosition` helper | off-screen rows measure in, growing `scrollHeight` by thousands of px, then the induced event dispatches with no gesture | converges to `stickToBottomRef === true`; scroll-to-bottom button not shown |
| F2 | chat-scroll-lock — no-gesture escape still releases | state-transition (illegal edge) | L1 | automated | view programmatically moved ABOVE the recorded pin position, no gesture | induced event dispatches | follow released; scroll-to-bottom button shown |
| F3 | chat-scroll-lock — attribution is single-use | state-transition | L1 | automated | pin snapshot recorded; one event falls through (consuming it) | a later event coincidentally reports the recorded `scrollTop` with grown content | follow NOT re-armed — the consumed snapshot cannot match again |
| F4 | chat-scroll-lock — scrollbar drag releases | state-transition | L1 | automated | pin snapshot recorded; no wheel/touch events at all | scroll event at a position off the recorded pin | clamp branch does not apply; follow released |
| F5 | chat-scroll-lock — attribution does not cross sessions | state-transition (illegal edge) | L1 | automated | snapshot recorded in session A | switch to session B; B's first scroll event dispatches | event is not matched against A's snapshot |
| F6 | chat-scroll-lock — all four pin sites tagged | decision-table | L1 | automated | each bottom-pin writer exercised in turn: virtualizer `onChange`, follow effect, session-switch near-bottom/first-visit, anchor-row-not-found fallback | growth-then-event after each | each one's induced event is attributable; the `idx >= 0` restore path and `scrollToBottom`/`scrollToTurn`/splice corrections leave pin refs untouched |
| F7 | chat-scroll-lock — clamp state survives a switch | state-transition | L1 | automated | a clamp-preserved event has just held the follow | switch away and back to the session | restores at the bottom with the scroll-to-bottom button hidden (not mid-transcript) |
| F8 | chat-scroll-lock — existing latches unregressed | state-transition | L1 | automated | existing `scrollToBottom`, `scrollToTop`, auto-load-intent, selection-suspended-pin and splice-suppress paths | their existing test suites | all pass unchanged |
| F9 | chat-selection-preservation — DOM identity survives context churn | state-convergence | L1 | automated | markdown containing a paragraph, inline code, a link and a table | re-render with a FRESH but equivalent `ToolContext` value | each of those DOM nodes is the same node instance (no replacement) |
| F10 | chat-selection-preservation — provider-less render | EP (invalid partition) | L1 | automated | `MarkdownContent` mounted with no `context` prop and outside any `MarkdownRenderContext` provider | render | renders without throwing; file mentions degrade to plain text |
| F11 | chat-selection-preservation — live selection survives background stream | state-convergence | L3 | automated | user holds a text selection in the selected session's transcript | a DIFFERENT, unselected session streams assistant output | selection stays anchored and non-collapsed throughout |
| F12 | mobile-resilience — banner cannot make the document scroll | state-transition | L3 | automated | mobile viewport 390×844 with the plugin-staleness banner visible (43 px) | render the mobile shell | `document.scrollHeight === window.innerHeight` (baseline defect: 887 vs 844) |
| F13 | mobile-resilience — banner appear/disappear cycle | state-transition | L3 | automated | mobile viewport, banner toggles on then off | observe after each transition | document remains non-scrollable in both states |
| F14 | mobile-resilience — navigation does not scroll the shell | state-transition | L3 | automated | mobile viewport with a banner visible | enter a session, then focus the composer | `document.scrollTop` stays 0; the header/progress bar stays at the top of the viewport |
| F15 | mobile-resilience — overlays add no flow height | decision-table | L3 | automated | mobile viewport with toast, worktree-init stack, spawn-error and recovery hosts, first-launch modal and add-folders dialog each mounted | mount each | document stays non-scrollable for every overlay (each is `fixed` / portalled) |
| F16 | ui-animation-energy — idle pauses decorative animation | state-transition | L3 | automated | visible dashboard, selected card plus a streaming background card | no input for the idle delay | `fx-idle` on the document root; background stripes and status dots report `animation-play-state: paused` |
| F17 | ui-animation-energy — resume on first input | state-transition | L3 | automated | animations paused by idle | one `pointerdown` | `fx-idle` cleared; animations report `running` on the next frame |
| F18 | ui-animation-energy — spinner exempt while idle | decision-table | L3 | automated | an in-flight operation showing an `animate-spin` indicator AND an `@mdi/react` `fx-progress` glyph | idle delay elapses (`fx-idle` only) | both indicators report `animation-play-state: running` |
| F19 | ui-animation-energy — hidden beats the exemption | decision-table | L3 | automated | same indicators, document marked BOTH `app-hidden` and `fx-idle` | inspect | both report `paused` — the hidden-window pause wins |
| F20 | ui-animation-energy — off-screen beats the exemption | decision-table | L3 | automated | an indicator inside an `.fx-offscreen` container, document `fx-idle` | inspect | reports `paused` — the off-screen pause wins |
| F21 | ui-animation-energy — static selection affordance retained | state-convergence | L1 | automated | selected `SessionCard` rendered | inspect classes | static ring/border affordance classes present (guards the CSS selectors against rename drift) |
| F22 | ui-animation-energy — paused UI stays legible | visual/subjective | — | manual-only | session list with mixed states, animations paused | a human looks at it | [judgment: every session's state is still distinguishable from static styling alone] |
| F23 | drag-body-style — page stays selectable after a real drag-unmount | state-transition | L3 | automated | desktop viewport, sidebar drag in progress | flip the breakpoint (or collapse the panel) so the dragger unmounts mid-drag | page text remains selectable; no residual resize cursor |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | content-copy — Clipboard API unavailable | fault-injection (abort) | L1 | automated | `navigator.clipboard.writeText` rejects; `execCommand("copy")` available | click `CopyButton` | text is copied via the fallback; ✓ shown; no hidden textarea left in the document |
| X2 | content-copy — both paths fail | fault-injection (abort) | L1 | automated | `writeText` rejects AND `execCommand` absent/returns false | click `CopyButton` | nothing throws; ✓ does NOT appear (failure stays silent by design) |
| X3 | content-copy — insecure context end-to-end | fault-injection (environment) | L3 | automated | dashboard served over a plain-http origin (the zrok/ngrok shape) | click a copy affordance | the ✓ feedback appears (the fallback path ran) |
| X4 | incremental-event-sync — late 404 after a discard | fault-injection (delay) | L1 | automated | a reconcile request in flight when its row goes terminal and its key is discarded | the 404 response lands and re-inserts the key | the key is discarded again by the NEXT tick — retained entries return to the running-row count |
| X5 | chat-scroll-lock — real gesture during replay wins | fault-injection (concurrent input) | L1 | automated | event replay in progress with the follow active | user wheels upward | follow released within 150 ms; scroll-to-bottom button appears; later replay batches do not pull the view back |

---

## Coverage summary

- Requirements covered: 7/7 capabilities; every `SHALL` clause in the seven delta specs maps to ≥ 1 row.
- Scenarios by class: edge 21 · perf 4 · frontend 23 · error 5 — **53 total**
- Scenarios by level: L1 36 · L2 0 · L3 14 · ci 1 · — (manual) 2
- Scenarios by disposition: automated 51 · manual-only 2

## New infra needed

- **P3 only.** Asserting the idle CPU collapse needs a Chrome-tracing harness
  (`CrGpuMain` / `VizCompositorThread` totals over a fixed idle window). This
  repo has no such level — `qa/` is CLI/process smoke and Playwright asserts
  rendered behaviour, not GPU-thread cost. Rather than invent an automatable
  proxy that would not measure the claim, P3 is routed `manual-only` and
  performed with the same DevTools trace method that produced the baseline
  numbers. F16/F20 cover the *mechanism* (animations report `paused`)
  automatically; P3 covers the *payoff*.
- No L2 rows: nothing in this change is install/spawn/multi-OS shaped — it is
  entirely client-local.
