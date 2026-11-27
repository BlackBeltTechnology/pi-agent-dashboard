# Design: mock-player-step-controls

## Context

- **Pane documents.** Scripted frames run in a same-origin `?pane=` iframe.
  - `site/Site.tsx` defines the pane route (`PANE` `:212`, `PaneOnly` `:213`).
  - `site/main.tsx` boots every document (`:3-9`): static imports, then
    `await setup?.()`, then `createRoot(...).render`. ES module imports evaluate before
    the module body.
  - `site/pane-runtime.ts` `startPane` (`:37`) drives the pane with `runSteps`
    (`site/script.ts`, options `{ upTo, fast, overlay, paused }` at `:92-102`; `paused`
    takes no argument, `:95`, `:103`). The loop (`:76-104`) resets per loop with
    `fx?.reset(); clock?.reset(); overlay?.clear(); await o.remount()`.
- **Which panes are scripted.** `PaneFrame` gets `scripted={drives(f, side)}`
  (`Site.tsx:125`). `drives` (`:31`) is true when the frame has a non-empty `script`
  (`:27`) and the side is the one the frame's `side` names, or `both`. `loop: false`
  frames count. A `step-k` pane is a driven pane with `o.step` set
  (`pane-runtime.ts:53-57`).
- **Shell messages.** Messages are flat and keyed by spec (`mkPane: spec, h`,
  `mkHealth: spec, …`, `mkReady: spec`; `Site.tsx:286-291`).
  - `PaneFrame` (`:267`) posts `mkPause` and `mkHidden`. `mkHidden` is set only when the
    pane is fully off-screen (`:302`).
  - The pane's listener is an if/else over `mkPause` / `mkHidden`
    (`pane-runtime.ts:65-71`). Every handler checks `event.source` and `originOk(e)`
    (`frame-env.ts:25`).
- **Pane height today.** The pane posts `document.documentElement.scrollHeight` from a
  ResizeObserver plus a 250 ms poll (`Site.tsx:228-234`). The shell sets the iframe
  height to it, sets `loaded`, and writes `mk-h:<spec>` to sessionStorage (`:286`). It
  seeds the next mount from that value, else 240 (`:270`).
  - The root `scrollHeight` is never smaller than the iframe's own height (measured: a
    500 px iframe with 100 px of content reports 500).
  - So the height is already grow-only, the stored value is the running maximum, and
    every first loop moves the site once for each new tallest step.
  - Until `loaded`, an opaque loading cover (`.mk-phone-load`, `position: absolute; inset: 1px`)
    sits over the iframe (`Site.tsx:312`).
- **Runner focus.**
  - `runSteps` focuses with `preventScroll: true` for type, clear and press
    (`script.ts:138`, `:143`, `:146`).
  - The `click` and `type` steps call `user.click` (`:132`, `:136`). user-event's click
    focuses the closest focusable with a bare `focus()`, which scrolls ancestor frames.
- **Component focus.** Real components focus and scroll on their own, for example
  `packages/automation-plugin/src/client/CreateAutomationDialog.tsx:388-398`
  (`scrollIntoView` at `:392`, then `focus()` at `:397`, when opened on a section).
- **Measured fix.** Patching the pane's `HTMLElement.prototype.focus` to force
  `preventScroll: true`, plus neutralising `scrollIntoView`, removed every host scroll
  jump in a live probe (host `scrollY` constant over 15 s of loops; focus still landed in
  the pane).
- **Overlay.** `createOverlay` (`pane-runtime.ts:57`) adds the `mk-scripted` body class,
  which pads the canvas by 48 px for the caption (`site.css:106`). The caption is
  `position: fixed` at the bottom of the pane viewport.
- **Health bar.** `.mk-health` is a wrapping flex row under the iframe (`site.css:107`,
  `Site.tsx:313-319`). Its loop counts and error text change at runtime.
- **Deep links.** `findInFrame` asks the pane for a ring with `mkFind` every 150 ms for
  3 s (`Site.tsx:326-340`).
- **Headless.** `mock-check` / `mock-video` load `?pane=…&mkLoops=1` as a top-level page
  (`packages/mockup-loop/src/mock-site/headless.mjs:86`, `:107`).

## Goals / Non-Goals

**Goals**
- Nothing that runs inside an embedded pane scrolls the reviewer's page.
- An embedded scripted pane appears at its final height and keeps it. Neither its steps
  nor its health bar move the rest of the site.
- Step forward and back through a script the reviewer paused.

**Non-Goals**
- **Keeping keyboard focus on the host page.** A step that focuses an element in the pane
  moves browser focus into the pane, as a real click would.
- **Clock fidelity on rewind.** The pane clock restarts at `clockAt` (see D3).
- **The `steps` + `play: true` player.** It is not a script runtime. Its panes keep
  following their content.
- **Viewport-relative layouts.**
  - A pane's viewport is the stage. Mocked `100vh` / fixed-position UI lays out against
    it.
  - Content that only fills its viewport has no content height of its own, so its stage
    is the placeholder height, as today.
- **The first measurement shift.** With no stored height (first visit in a tab, or an
  opaque frame where storage is unavailable), the stage replaces the 240 px placeholder
  once, when the pane mounts near the viewport. Panes above the viewport are covered by
  the browser's scroll anchoring where supported.
- **In-pane reveal for the runner's own focus.** The runner keeps `preventScroll: true`
  (`script.ts:138`, `:143`, `:146`), as today, so headless check and video behave the
  same.

## Decisions

### D1 — One pane scroll guard

**Module.** `site/pane-scroll-guard.ts` is a side-effect module. On import it installs
the guard when `location.search` has `pane=` and `window.parent !== window`, so
top-level and headless panes keep native scrolling. `site/main.tsx` imports it
**first**, so it runs before `virtual:mock-site/app`, `Site.tsx`, `setup()` and render.

**What it patches** (only methods that exist; nothing new is defined):
- `HTMLElement.prototype.focus` and `SVGElement.prototype.focus`:
  - Call the original with `{ ...opts, preventScroll: true }`.
  - If the element is now `document.activeElement` and the caller did not pass
    `preventScroll: true`, reveal it in the pane.
- `Element.prototype.scrollIntoView(arg)` reveals the element in the pane.
  - `block` follows `arg`: `true` → `start`, `false` → `end`, an object → its `block`
    (default `start`, as native).
  - `inline` is `nearest`. `behavior` is ignored (instant).
- `Element.prototype.scrollIntoViewIfNeeded()`, when present, reveals with `nearest`.

**Reveal (module-private).** Walk from the element through each ancestor inside the pane
document that can scroll: `overflow` not `visible`, and
`scrollHeight > clientHeight || scrollWidth > clientWidth` (this includes
`overflow: hidden` and `clip` containers, which native reveal also scrolls). Adjust each
one's `scrollTop` / `scrollLeft` so the element is visible, then scroll the pane window,
which is its own scrollport. Never touch an ancestor document.

**Runner.** No runner change. user-event's bare `focus()` on click goes through the
guard. Pre-focusing before `user.click` was rejected because it changes event order and
can disagree with user-event's `isFocusable`.

**Outside the guarantee** (documented):
- fragment navigation inside a pane;
- browser-native focus without a JS call (`autofocus`, `<dialog>.showModal()` initial
  focus, label activation);
- a `focus` captured from a prototype before the guard module ran.

Scrolls the shell starts itself (ring deep links) are not pane calls and are unaffected.

Rejected:
- Pausing partly visible panes. That hides the behaviour under review.
- Restoring the host `scrollY` after unexpected scrolls. Racy, and it flickers.
- Making `scrollIntoView` a no-op. That breaks components that scroll their own lists.

### D2 — Step gate as an explicit state machine

`site/step-gate.ts` exports `createStepGate()` and `Rewind`. Indices count **completed
steps** `k` (0..N).
- `runSteps` calls `paused(k)` before step `k + 1` runs, including before an
  `unless`-skipped step, which counts.
- The runtime calls `gate.wait(N)` before the end-of-loop hold.
- The gate calls `onHeld(k)` on entering `held(k)`.

**States**

| State | Meaning |
|---|---|
| `playing` | Not paused, not hidden. `wait` resolves at once. |
| `held(k)` | Paused or hidden, resting after `k` completed steps. |
| `running(k, q)` | Paused while step `k + 1` runs. `q` is the queued forwards, 0 or 1. |
| `rewinding` | Remount and silent replay in progress. |
| `stopped` | After a failed loop. |

**Inputs (`mkStep`)**

| Input | `playing` | `held(k)` | `running(k, q)` | `rewinding` / `stopped` |
|---|---|---|---|---|
| Forward | Dropped. | `k < N`: release step `k + 1`. `k = N`: looping → remount to `held(0)`; `loop: false` → no-op. | `q = 1`; extra presses dropped. | Dropped. |
| Back | Dropped. | `Rewind(max(0, k - 1))`. | Clears `q`. When step `k + 1` ends, `Rewind(k)`: back to resting after `k`, undoing the in-flight step. | Dropped. |

**Pause and hidden**
- Unpause → `playing`. It clears `q` and any pending rewind. If a rewind is in progress,
  the unpause applies after the replay lands.
- Hidden holds the gate like pause. A released or queued step waits while hidden.
- A `loop: false` script that finished stays `held(N)`: Back works, Forward is a no-op.

**Messages** (flat, keyed by spec, like `mkPane`)
- Shell → pane: `mkStep: -1 | 1`. Accepted only when `event.source === parent` and
  `originOk(e)`. It gets its own branch in the pane listener, beside `mkPause` /
  `mkHidden`.
- Pane → shell: `mkGate: spec, state`, on every change. `state` is `"playing" | "held" | "busy" | "stopped"`;
  `running` and `rewinding` map to `busy`.

**Shell**
- `◀` / `▶` live in a slot that always takes its space (`visibility: hidden` when not
  shown).
- They are shown only when the **reviewer** paused the pane and the gate is not
  `stopped`.
- While `busy` they are `aria-disabled` (focus is kept, presses ignored). A gate held
  only because the pane is hidden shows no controls.
- Each scripted `PaneFrame` (both sides of a `side: "both"` frame) has its own bar and
  gate.
- On `mkReady` (iframe reload) the shell resets its gate view.
- `.mk-health` becomes a single non-wrapping line: the error text is truncated with its
  full text in `title`. Loop counts, errors and controls never change the bar's height.

### D3 — Rewind by remount + silent replay, then continue; resting captions

`runSteps` gains `from` (default 0) and passes `k` to `paused`. On `Rewind(to)` the
runtime catches the rejection (`instanceof Rewind`; other throws propagate as today),
then:
1. enters `rewinding`;
2. resets the loop: `fx?.reset(); clock?.reset(); overlay?.clear(); await o.remount()`;
3. replays silently: `runSteps(doc, script, { upTo: to, fast: true, overlay: null })`,
   with no `paused` hook, no health change and no `mkHealth`;
4. enters `held(to)`;
5. continues the same loop visibly: `runSteps(doc, script, { from: to, overlay, paused })`.

**Resting caption.** `onHeld(k)` sets the caption on the retained overlay: `k/N` plus
step `k`'s `say` (1-based), or `0/N start` at `k = 0`.

**Replay failure.** A failing replayed step counts as one failed loop: health
increments once, `mkHealth` is posted once, the error is shown, and the gate moves to
`stopped`.

**Accepted limitations**
- Fast replay skips the minimum step time and typing delays.
- The pane clock restarts at `clockAt`.

### D4 — Pre-measured fixed stage

Applies to an **embedded, live, driven pane**: `scripted`, not top-level, not `step-k`,
and no `mkLoops`.

**Pre-measure.** The shell's opaque loading cover already hides the pane, so the content
stays fully rendered and focusable. Before the first visible loop, the runtime:
1. creates the overlay first (`mk-scripted` class and caption padding in place);
2. runs one silent loop with `runSteps(doc, script, { fast: true, overlay: null })`,
   ignoring pause and hidden, with no health count;
3. takes the pane's height throughout, with a ResizeObserver plus a sample after mount
   and after each step, where the step waits until the height is stable for 200 ms
   (capped at 1 s per step):
   `m = root.scrollHeight > root.clientHeight ? root.scrollHeight : body content height`,
   so overflow such as open menus counts and a stale tall placeholder does not;
4. stops after a total budget of 15 s, or at a failing step, keeping the max so far;
5. posts `mkStage: spec, h: max`;
6. resets the loop (`fx?.reset(); clock?.reset(); overlay?.clear(); await o.remount()`)
   and starts loop 1.

The pane answers `mkFind` only after `mkStage`.

**Shell.** For a scripted pane, `PaneFrame` ignores `mkPane` until `mkStage`. Before
that, `loaded` stays false and the loading line ("Loading pane…", unchanged) shows at
the stored height, else 240. On `mkStage` it:
- sets `h = max(current stage, h)`; the first `mkStage` sets it outright;
- sets `loaded`;
- writes `mk-h:<spec>`;
- re-runs a pending deep-link lookup.

Afterwards, an `mkPane` larger than `h` grows the pane, as a fallback. Nothing shrinks
it while the page is open. A later `mkStage` (iframe reload) can only grow it.
`findInFrame` waits for the stage before starting its 3 s budget.

**Why every load.** Each page load re-measures, so an edited, shorter mock gets a
shorter stage on reload. The stored value is only the placeholder.

**Overlay.** The caption stays `position: fixed` at the bottom of the pane viewport,
which is now the stage: a subtitle bar at the bottom of a fixed player. Intended.

Rejected:
- Grow-only (today's behaviour): the site moves during every first loop.
- An author-set `Frame.height`: a new authoring field that drifts from the content.
- Pre-measure only when no stored height exists: an edited mock keeps a stale stage.
- Hiding content with `visibility: hidden` while measuring: hidden elements cannot take
  focus, so typed steps would mis-measure.

**Cost.** A scripted pane shows its loading line for one fast loop (budget 15 s). Panes
measure independently when they mount near the viewport.

## Risks

- **Script replay.** A script whose steps are not idempotent against fresh fixtures
  would replay or pre-measure differently. Fresh fixtures per loop already require
  replayable scripts.
- **Pane guard changes behaviour.** A mocked component that relies on page-level
  scrolling scrolls only inside its pane. Intended; documented in
  `references/live-mock-site.md`.
- **Timing-dependent content.** Content taller in the live loop than in pre-measure grows
  the stage once (the shell fallback).
- **Pre-measure ignores visibility** (`chat-idle-render-cost` is a different capability;
  named here as a deliberate exception). It runs one bounded loop per mount, then
  normal visibility gating applies.
