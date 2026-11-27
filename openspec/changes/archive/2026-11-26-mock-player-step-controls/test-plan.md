# Test Plan — mock-player-step-controls
Stage: design   Generated: 2026-11-25

Levels:
- **L1**: `packages/mockup-loop/site/__tests__/*.test.ts` (vitest; DOM tests use an inline
  `// @vitest-environment jsdom` pragma; exemplar `site/__tests__/site-core.test.ts`).
- **L3**: `tests/e2e/mock-site/mock-site.spec.ts` (`npm run test:e2e:mock-site`; fixture
  project in `tests/e2e/mock-site/fixture.ts`; exemplar test "stateful fixtures: panes
  isolated, pointer aims before the click, captions per step, loops reset (F3, F8, F9)").

Gate: hard (design stage). No unfillable slots, so there are no clarifications.

---

## Scenarios

### Edge-case
| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Deterministic time and looping (Step forward) | state-transition | L1 | automated | gate for N=3, paused, `held(1)` | Forward | step 2 is released once; gate enters `running(1,0)`, then `held(2)` after the step resolves |
| E2 | Step forward at end | state-transition | L1 | automated | gate N=3 at `held(3)`, looping vs `loop:false` | Forward | looping: remount requested, then `held(0)`; `loop:false`: no event, state stays `held(3)` |
| E3 | Step back at start | BVA (k=0) | L1 | automated | gate at `held(0)` | Back | rejects with `Rewind(0)` |
| E4 | Step back while paused | BVA (k=1, k=N) | L1 | automated | gate at `held(1)` and `held(3)` | Back | `Rewind(0)` and `Rewind(2)` respectively |
| E5 | Repeated Step forward while a step runs | BVA (presses 1, 2, 3) | L1 | automated | gate `running(1,0)` | Forward ×1, ×2, ×3 | `q` is 1 in every case; after step 2 resolves exactly one more step (3) is released, then `held(3)` |
| E6 | Step back while a step runs | state-transition | L1 | automated | gate `running(1,1)` (step 2 in flight, one queued) | Back, then step 2 resolves | queue cleared; next wait rejects with `Rewind(1)` |
| E7 | Illegal inputs dropped | state-transition (illegal edges) | L1 | automated | gate in `playing`, `rewinding`, `stopped` | Forward and Back each | no release, no `Rewind`, state unchanged |
| E8 | Hidden pane does not step | decision-table (paused × hidden × queued) | L1 | automated | gate `held(1)`, hidden=true | Forward | step not released while hidden; released when hidden=false |
| E9 | Unpause clears queue / rewind | state-transition | L1 | automated | gate `running(1,1)` with a pending Back | Unpause | `playing`; no `Rewind`; no extra step released beyond the loop's own |
| E10 | `onHeld` and resting index | state-transition | L1 | automated | gate N=3 | enter `held(0)`, `held(2)` | `onHeld` called with 0, then 2 |
| E11 | `runSteps` `from` + `paused(k)` | EP | L1 | automated | 4-step script, step 2 has `unless` satisfied | `runSteps({ from: 1, paused })` | steps 2..4 considered; `paused` called with 1, 2, 3 (skipped step counts); step 1 not run |
| E12 | Guard: focus forced quiet | EP | L1 | automated | embedded `?pane=` jsdom window with guard; spy on original `focus` | `el.focus()`, `el.focus({ preventScroll: false })`, SVG `focus()` | original always called with `preventScroll: true`; target is `activeElement` |
| E13 | Guard install conditions | decision-table (pane param × embedded) | L1 | automated | window with/without `pane=`, `parent === window` vs not | import guard module | patched only when `pane=` present AND embedded; otherwise prototypes untouched |
| E14 | Guard does not define missing APIs | EP | L1 | automated | jsdom without `scrollIntoView` / `scrollIntoViewIfNeeded` | install guard | neither method becomes defined |
| E15 | `scrollIntoView` argument mapping | EP | L1 | automated | in-pane scrollable container (stubbed `scrollHeight`/`clientHeight`/rects) with a row below | `scrollIntoView(true)`, `(false)`, `({block:"center"})`, `()` | container `scrollTop` set to the start / end / center / start position; host window `scrollTo` never called |
| E16 | Rewind only catches `Rewind` | EP | L1 | automated | gate wait rejecting with `Rewind(1)` vs a plain `Error` | runtime loop handler | `Rewind` → replay path; `Error` → propagates as today (counted failure) |

### Performance
| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Measurement is bounded | threshold | L3 | automated | fixture script whose step waits on a target that never appears, `timeout` 30000 | time from pane mount to loading line gone ≤ 16 s (15 s budget + 1 s slack) | one page load |
| P2 | Pane never scrolls the page (soak) | soak | L3 | automated | fixture scripted frame with a component that focuses + `scrollIntoView` on open, pane partly visible | host `scrollY` delta = 0 | 5 consecutive loops |

### Frontend-quirk
| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | A pane never scrolls the reviewer's page (runner click) | state-convergence | L3 | automated | scripted pane whose click target is above the viewport; host scrolled so pane is partly visible | click step runs | host `scrollY` unchanged; target is the pane's `activeElement` |
| F2 | A pane never scrolls the reviewer's page (component focus) | state-convergence | L3 | automated | fixture component calling `scrollIntoView` then `focus()` on open; element off-screen in the host | the step opens it | host `scrollY` unchanged; element is the pane's `activeElement` |
| F3 | Inner scroll container still reveals its row | EP (overflow auto / hidden) | L3 | automated | pane component with a 200 px list (`overflow:auto`, and a variant `overflow:hidden`) whose row 30 is off-list | component calls `scrollIntoView()` on row 30, then `focus()` on row 40 | list `scrollTop` > 0 and row visible within the list rect; host `scrollY` unchanged |
| F4 | Guard runs before app setup | state-convergence | L3 | automated | fixture app module calling `focus()` on an element at module top level | embedded pane loads | host `scrollY` unchanged |
| F5 | Top-level pane keeps native scrolling | EP | L3 | automated | `?pane=<spec>` opened top-level at 300 px viewport height; focus target 1000 px down | step focuses it via user-event click | pane document `scrollY` > 0 |
| F6 | Site does not move while the script loops | state-convergence | L3 | automated | fixture script: step 1 expands a 400 px panel, step 2 collapses it; a frame below | pane appears; 3 loops | iframe height constant from first visible frame; next frame's `getBoundingClientRect().top + scrollY` constant |
| F7 | Loading line while measuring | EP (stored / none) | L3 | automated | fresh session vs session with `mk-h:<spec>` = 700 | page load | during measuring: loading cover visible at 240 / 700 px, no caption overlay visible; cover gone after `mkStage` |
| F8 | Edited mock re-measures | state-transition | L3 | automated | fixture mock whose tallest step is 900 px, then edited to 500 px | reload page | iframe height ≈ new tallest (±2 px), not 900 |
| F9 | Typed step is measured | state-convergence | L3 | automated | type step into a field that opens a 300 px suggestion list overflowing the body | pane measures, then 2 visible loops | iframe height includes the list; height unchanged across visible loops |
| F10 | Live content taller than measured | state-transition | L3 | automated | fixture content that renders an extra 200 px block only after 800 ms of real time | visible loop reaches it | iframe grows once; never decreases afterwards over 2 loops |
| F11 | Reduced-motion step panes follow their content | EP | L3 | automated | `prefers-reduced-motion: reduce`, same frame as F6 | step panes render | each step pane's iframe height = its own content height (differ by ~400 px) |
| F12 | Step forward / back + captions | state-transition | L3 | automated | 3-step stateful-fixture script, reviewer pauses at start | Forward ×2, Back ×1, Back ×2 | captions `1/3 …`, `2/3 …`, `1/3 …`, `0/3 start`; after Back the step-1 state shows original fixture data; loop counts unchanged |
| F13 | Step forward at end of looping / finished one-shot back | state-transition | L3 | automated | looping 3-step script paused after step 3; `loop:false` script finished | Forward / pause + Back | looping: remount, caption `0/3 start`; one-shot: caption `2/3 …` |
| F14 | Controls disabled while busy | state-convergence | L3 | automated | paused at step 3 of a script whose steps each wait 500 ms | Back pressed, focus on ◀ | during replay both buttons `aria-disabled="true"`, focus still on ◀, an extra press is ignored (caption lands at `2/3 …`) |
| F15 | Long error does not move the site | BVA (short / 300-char error) | L3 | automated | scripted frame whose step fails with a 300-character message; a frame below | loop fails | `.mk-health` height = one-line height; next frame's top unchanged |
| F16 | Controls only when reviewer paused | decision-table (reviewer-paused × hidden) | L3 | automated | playing pane scrolled fully off-screen, then back partly in view | observe controls before resume; then click Pause | no ◀/▶ while only hidden; ◀/▶ visible after Pause |
| F17 | Controls do not change frame height | EP | L3 | automated | phone (375 px) scripted frame | Pause, then Play | wrapper height and next frame's top identical before / after |
| F18 | Deep link to a ring in a scripted pane | state-convergence | L3 | automated | site opened at a ring ref inside a scripted pane below the fold | page load | after the pane's stage arrives, ring is in the viewport and has `mk-hit` |
| F19 | Hidden pane does not step | state-convergence | L3 | automated | paused pane, Forward pressed mid-step, then scrolled fully off-screen | queued step due | caption unchanged while off-screen; advances one step after scrolling back |
| M1 | Fixed stage reads as a player | visual/subjective | — | manual-only | pane with short and tall steps | human looks at the stage and bottom caption | [judgment: empty space under short steps and the bottom caption feel like a fixed player — no automatable observable] |

### Error-handling
| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Failing step during measurement | fault-injection (abort) | L3 | automated | step 2 targets a missing element | pane measures | pane appears at the height measured after step 1; visible loop shows the failure; `failed` = 1 (pre-measure not counted) |
| X2 | Replay failure | fault-injection (abort) | L1 | automated | gate in `rewinding`; replay reports a failed step | runtime handles the replay result | gate → `stopped`; health `failed` +1 exactly once; one `mkHealth` posted |
| X3 | Step message from a foreign window | fault-injection (spoof) | L3 | automated | a sibling iframe / top window posts `mkStep: 1` to the pane | message delivered | pane caption and gate state unchanged |
| X4 | Iframe reload mid-session | fault-injection (restart) | L3 | automated | scripted pane at stage 800 px; iframe reloaded (`location.reload()` inside it) | second `mkStage` arrives (e.g. 600) | iframe height stays 800 (never shrinks); controls reset to the playing view |
| X5 | Controls hide after a failed loop | state-transition | L3 | automated | scripted pane whose loop failed | reviewer clicks Pause | no ◀/▶ shown |

---

## Coverage summary
- Requirements covered: 8/8 (Visible cursor and captions; Deterministic time and looping; Scripted panes are pre-measured fixed stages; Frames render real components (scripted-pane exception); A pane never scrolls the reviewer's page; Reference links and deep-link navigation (scripted pane); mockup-site-environment message acceptance (`mkStep`); headless top-level behaviour)
- Scenarios by class: edge 16 · perf 2 · frontend 20 · error 5
- Scenarios by level: L1 17 · L2 0 · L3 25
- Scenarios by disposition: automated 42 · manual-only 1

## New infra needed
- None new. The L3 rows extend the existing mock-site fixture project (`tests/e2e/mock-site/fixture.ts`) with scripted frames for growth/collapse, component focus on open, inner scroll lists, typed suggestions, delayed content, a failing step, a slow target and a long error.
