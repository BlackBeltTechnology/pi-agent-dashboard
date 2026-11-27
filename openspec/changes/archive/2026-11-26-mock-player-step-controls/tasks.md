# Tasks: mock-player-step-controls

## 1. Pane never scrolls the page

- [x] 1.1 New side-effect module `packages/mockup-loop/site/pane-scroll-guard.ts`: when `location.search` has `pane=` and `window.parent !== window`, patch existing HTML/SVG `focus` (forced `preventScroll`; in-pane reveal when it became `activeElement` and the caller did not pass `preventScroll: true`), `scrollIntoView` (`true`→start, `false`→end, object→`block`, default start; instant) and `scrollIntoViewIfNeeded` only when present (nearest); module-private reveal walks in-pane ancestors with non-`visible` overflow and scroll range, then the pane window, never ancestor documents (design D1).
- [x] 1.2 `packages/mockup-loop/site/main.tsx`: `import "./pane-scroll-guard.ts"` as the first import.

## 2. Pre-measured fixed stage

- [x] 2.1 `packages/mockup-loop/site/pane-runtime.ts`: for an embedded, live (no `mkLoops`), non-`step-k` driven pane, create the overlay first, then run one silent fast pass (`overlay: null`, no pause/hidden, no health); sample `m = root.scrollHeight > root.clientHeight ? root.scrollHeight : body content height` via ResizeObserver and after mount + each step (settle 200 ms stable, cap 1 s/step); stop at a 15 s budget or a failing step; post `mkStage: spec, h`; then `fx?.reset(); clock?.reset(); overlay?.clear(); await o.remount()` and start loop 1; answer `mkFind` only after `mkStage` (design D4).
- [x] 2.2 `packages/mockup-loop/site/Site.tsx` `PaneFrame`: for scripted panes ignore `mkPane` (no `setH`, no `setLoaded`, no store write) until `mkStage`; keep the "Loading pane…" cover at the stored height, else 240; on `mkStage` set `h` (first) or `max(h, stage)` (later, e.g. after iframe reload), `setLoaded(true)`, write `mk-h:<spec>`, re-run a pending deep-link lookup; afterwards apply `mkPane` only when larger (`setH(p => Math.max(p, h))`, `isScripted` in the effect deps); `findInFrame` starts its 3 s budget after the stage for scripted panes; non-scripted panes unchanged.

## 3. Step gate + runner seam

- [x] 3.1 New `packages/mockup-loop/site/step-gate.ts`: `createStepGate`, `Rewind`, `onHeld(k)`; states `playing | held(k) | running(k, q) | rewinding | stopped` over completed-step counts `k`, with the D2 input table (Forward at `N`: loop → remount to `held(0)`, `loop: false` → no-op; one queued forward; Back in `held(k)` → `Rewind(max(0, k-1))`, in `running(k)` → `Rewind(k)` after the step; everything dropped in `playing` / `rewinding` / `stopped`; hidden holds like pause).
- [x] 3.2 `packages/mockup-loop/site/script.ts` `runSteps`: add `from` (default 0); call `paused(k)` with the completed-step count before each step, including `unless`-skipped steps; keep the existing `preventScroll: true` focus calls.

## 4. Runtime + shell

- [x] 4.1 `packages/mockup-loop/site/pane-runtime.ts`: the gate replaces the inline pause/hidden state (`:62-63`) and gates the end-of-loop hold (`wait(N)`); a finished `loop: false` script stays `held(N)`; add an `mkStep` branch to the listener (accepted only when `event.source === parent` and `originOk(e)`); post `mkGate: spec, state` (`playing | held | busy | stopped`) on every change.
- [x] 4.2 `pane-runtime.ts` rewind: catch only `instanceof Rewind`; enter `rewinding`; `fx?.reset(); clock?.reset(); overlay?.clear(); await o.remount()`; `runSteps(doc, script, { upTo: to, fast: true, overlay: null })` with no `paused` hook, health or `mkHealth`; enter `held(to)`; continue the loop with `runSteps(doc, script, { from: to, overlay, paused })`; a replay failure counts one failed loop, posts `mkHealth` once, shows the error and moves to `stopped` (design D3).
- [x] 4.3 `pane-runtime.ts` resting caption: `onHeld(k)` sets the retained overlay caption to `k/N` + step `k`'s `say`, or `0/N start` at 0.
- [x] 4.4 `packages/mockup-loop/site/Site.tsx` `PaneFrame` + `site.css`: `◀` / `▶` (aria-labelled Step back / Step forward, `.mk-btn` tokens) in an always-reserved slot; shown only when the reviewer paused and the gate is not `stopped`; `aria-disabled` while `busy`; post `mkStep`; reset the gate view on `mkReady`; `.mk-health` one non-wrapping line with the error truncated (full text in `title`).

## 5. Docs + release

- [x] 5.1 `packages/mockup-loop/references/live-mock-site.md` § Scripts: pre-measured fixed stage (loading line while measuring, 15 s budget, never shrinks, first-visit shift); Pause + Step ◀/▶ (back = remount + replay; clock restarts at `clockAt`); embedded panes never scroll the reviewer's page, mocked components' own scrolling stays inside the pane, and what is outside the guarantee (fragment navigation, native `autofocus` / `showModal` / label focus).
- [x] 5.2 `packages/mockup-loop/.pi/skills/frontend-mockup-loop/SKILL.md` "Behaviour is shown" paragraph (`:162`): one line on stepping a paused scripted frame.
- [x] 5.3 `packages/mockup-loop/site/AGENTS.md` rows: `Site.tsx`, `main.tsx`, `pane-runtime.ts`, `script.ts`, `site.css`, new `pane-scroll-guard.ts`, new `step-gate.ts`.
- [x] 5.4 Root `CHANGELOG.md` `## [Unreleased]`: `### Fixed` (mock site: panes no longer scroll the page or grow while looping) and `### Added` (mock site: step controls).

## 6. Tests: L1 (vitest; see packages/mockup-loop/site/__tests__/site-core.test.ts for harness glue; DOM files use an inline `// @vitest-environment jsdom` pragma)

- [x] 6.1 `site/__tests__/step-gate.test.ts`: gate N=3 paused at `held(1)` · Forward · step 2 released once, `running(1,0)` then `held(2)` (test-plan #E1)
- [x] 6.2 `step-gate.test.ts`: `held(3)` looping vs `loop:false` · Forward · looping requests remount then `held(0)`; one-shot stays `held(3)` with no event (test-plan #E2)
- [x] 6.3 `step-gate.test.ts`: `held(0)` · Back · rejects with `Rewind(0)` (test-plan #E3)
- [x] 6.4 `step-gate.test.ts`: `held(1)` and `held(3)` · Back · `Rewind(0)` and `Rewind(2)` (test-plan #E4)
- [x] 6.5 `step-gate.test.ts`: `running(1,0)` · Forward ×1/×2/×3 · `q` is 1 each time; exactly one extra step released, then `held(3)` (test-plan #E5)
- [x] 6.6 `step-gate.test.ts`: `running(1,1)` · Back then step 2 resolves · queue cleared, next wait rejects `Rewind(1)` (test-plan #E6)
- [x] 6.7 `step-gate.test.ts`: `playing` / `rewinding` / `stopped` · Forward and Back · no release, no `Rewind`, state unchanged (test-plan #E7)
- [x] 6.8 `step-gate.test.ts`: `held(1)` with hidden=true · Forward · not released while hidden, released when visible (test-plan #E8)
- [x] 6.9 `step-gate.test.ts`: `running(1,1)` with pending Back · Unpause · `playing`, no `Rewind`, no extra release (test-plan #E9)
- [x] 6.10 `step-gate.test.ts`: gate N=3 · enter `held(0)` then `held(2)` · `onHeld` called with 0 then 2 (test-plan #E10)
- [x] 6.11 `site/__tests__/script-steps.test.ts` (jsdom): 4-step script with step 2 `unless` satisfied · `runSteps({ from: 1, paused })` · steps 2..4 considered, `paused` called with 1, 2, 3, step 1 not run (test-plan #E11)
- [x] 6.12 `site/__tests__/pane-scroll-guard.test.ts` (jsdom): embedded `?pane=` window with guard, spy on original `focus` · `focus()`, `focus({preventScroll:false})`, SVG `focus()` · original always gets `preventScroll: true`, target is `activeElement` (test-plan #E12)
- [x] 6.13 `pane-scroll-guard.test.ts`: with/without `pane=` × embedded/top-level · import module · patched only when `pane=` and embedded (test-plan #E13)
- [x] 6.14 `pane-scroll-guard.test.ts`: jsdom lacking `scrollIntoView` / `scrollIntoViewIfNeeded` · install · neither becomes defined (test-plan #E14)
- [x] 6.15 `pane-scroll-guard.test.ts`: in-pane container with stubbed scroll metrics and a row below · `scrollIntoView(true)`, `(false)`, `({block:"center"})`, `()` · container `scrollTop` at start/end/center/start; host `scrollTo` never called (test-plan #E15)
- [x] 6.16 `site/__tests__/pane-runtime.test.ts` (jsdom): gate wait rejecting with `Rewind(1)` vs plain `Error` · loop handler · `Rewind` → replay path; `Error` → counted failure as today (test-plan #E16)
- [x] 6.17 `pane-runtime.test.ts`: gate `rewinding`, replay reports a failed step · runtime handles it · gate `stopped`, health `failed` +1 once, one `mkHealth` posted (test-plan #X2)

## 7. Tests: L3 (Playwright, `npm run test:e2e:mock-site`; see tests/e2e/mock-site/mock-site.spec.ts "stateful fixtures: panes isolated, pointer aims before the click, captions per step, loops reset (F3, F8, F9)" for harness glue; extend fixture frames in tests/e2e/mock-site/fixture.ts)

- [x] 7.1 Fixture step waits on a never-appearing target (`timeout` 30000) · page load · loading line gone within 16 s of pane mount (test-plan #P1)
- [x] 7.2 Fixture component focuses + `scrollIntoView` on open, pane partly visible · 5 loops · host `scrollY` delta 0 (test-plan #P2)
- [x] 7.3 Click target above viewport, pane partly visible · click step · host `scrollY` unchanged, target is pane `activeElement` (test-plan #F1)
- [x] 7.4 Component `scrollIntoView` + `focus()` on open, element off-screen · step opens it · host `scrollY` unchanged, element is pane `activeElement` (test-plan #F2)
- [x] 7.5 200 px list (`overflow:auto` and `overflow:hidden` variants) · `scrollIntoView()` on row 30, `focus()` on row 40 · list `scrollTop` > 0, row inside list rect, host `scrollY` unchanged (test-plan #F3)
- [x] 7.6 Fixture app module calls `focus()` at top level · embedded pane loads · host `scrollY` unchanged (test-plan #F4)
- [x] 7.7 Top-level `?pane=` at 300 px viewport, target 1000 px down · click step focuses it · pane document `scrollY` > 0 (test-plan #F5)
- [x] 7.8 Script expands then collapses a 400 px panel, frame below · pane appears + 3 loops · iframe height and next frame's top constant (test-plan #F6)
- [x] 7.9 Fresh session vs `mk-h:<spec>`=700 · page load · cover at 240 / 700 px, no caption overlay while measuring; cover gone after `mkStage` (test-plan #F7)
- [x] 7.10 Mock tallest step 900 px then edited to 500 px · reload · iframe height ≈ new tallest ±2 px (test-plan #F8)
- [x] 7.11 Type step opens a 300 px overflowing suggestion list · measure + 2 loops · height includes list, unchanged across loops (test-plan #F9)
- [x] 7.12 Extra 200 px block appears after 800 ms real time · visible loop reaches it · iframe grows once, never decreases over 2 loops (test-plan #F10)
- [x] 7.13 `prefers-reduced-motion: reduce`, F6 frame · step panes render · each step pane height = own content height (test-plan #F11)
- [x] 7.14 3-step stateful script paused at start · Forward ×2, Back ×1, Back ×2 · captions `1/3 …`, `2/3 …`, `1/3 …`, `0/3 start`; original fixture data after Back; loop counts unchanged (test-plan #F12)
- [x] 7.15 Looping script paused after step 3; finished `loop:false` script · Forward / pause + Back · `0/3 start` after remount; one-shot caption `2/3 …` (test-plan #F13)
- [x] 7.16 Paused at step 3, steps wait 500 ms, focus on ◀ · Back · both buttons `aria-disabled="true"` during replay, focus on ◀, extra press ignored (lands `2/3 …`) (test-plan #F14)
- [x] 7.17 Step fails with a 300-char message, frame below · loop fails · `.mk-health` one line high, next frame's top unchanged (test-plan #F15)
- [x] 7.18 Playing pane fully off-screen then partly back · observe, then Pause · no ◀/▶ while only hidden; ◀/▶ after Pause (test-plan #F16)
- [x] 7.19 Phone scripted frame · Pause then Play · wrapper height and next frame's top identical (test-plan #F17)
- [x] 7.20 Site opened at a ring ref inside a scripted pane below the fold · load · after stage, ring in viewport with `mk-hit` (test-plan #F18)
- [x] 7.21 Paused pane, Forward mid-step, scrolled fully off-screen · queued step due · caption unchanged off-screen; advances one step when back (test-plan #F19)
- [x] 7.22 Step 2 targets a missing element · pane measures · appears at step-1 height; visible loop shows the failure; `failed` = 1 (test-plan #X1)
- [x] 7.23 Sibling iframe / top window posts `mkStep: 1` to the pane · delivered · caption and gate unchanged (test-plan #X3)
- [x] 7.24 Pane at stage 800 px; iframe reloads, second `mkStage` 600 · arrives · height stays 800; controls reset to playing view (test-plan #X4)
- [x] 7.25 Pane whose loop failed · reviewer clicks Pause · no ◀/▶ shown (test-plan #X5)

## 8. Manual verification

- [x] 8.1 Look at a scripted pane with short and tall steps: empty space under short steps and the bottom caption read as a fixed player (test-plan: manual-only, #M1)

## 9. Gates

- [x] 9.1 `npx tsc -p packages/mockup-loop/site --noEmit`; `npx vitest run packages/mockup-loop`; `npm run test:e2e:mock-site`.
- [x] 9.2 `review-code` pass on the diff; `npm run quality:changed`.
- [x] 9.3 `openspec validate mock-player-step-controls`.
