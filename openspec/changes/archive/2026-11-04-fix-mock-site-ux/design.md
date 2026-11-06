# Design

## D1 Example out of the mock roots
`mockRoots()` (`packages/mockup-loop/src/mock-site/discover.mjs:14`) scans only
`mockups/` and `openspec/changes/*/mockups/`. Moving the example to
`packages/mockup-loop/examples/` removes it from discovery with no discovery
change. `makeE2eProject()` (`tests/e2e/mock-site/fixture.ts:22`) copies it into
the temp project's `mockups/`, so every E2E ref (`/1/current/2`, `/2/current/1`)
stays valid. Ring numbers and frame order of frames 1–2 are kept.

## D2 Steps instead of clicks
Mocks stay prop-driven. A frame with `steps` renders its `proposed` pane as a
strip of step cards (`<n><letter> label`), each card a ref target
`<id>/<n>/proposed/step-<k>`; `step-<k>` matches the existing ring segment
grammar (`RING_RE`, `refs.mjs:10`), so `parseRef` and deep-link scrolling
(`Site.tsx` hash effect, deepest existing id wins) need no change. Ring numbers
must stay unique across the steps of one frame (one id namespace per side).
`play: true` stacks the steps in one pane and crossfades (450 ms, 2.5 s/step)
with Pause/Play + per-step dots; `prefers-reduced-motion: reduce` renders the
strip. `Tap` wraps the element whose click leads to the next step: static dot
in the strip, pulse in the player. `steps` together with `current`/`proposed`
is a problem entry, not a crash: steps win.

## D3 Overview, not thumbnails
A live-render thumbnail grid duplicates every pane: duplicate `data-testid`s and
rings break the E2E contract (F1 `querySelector(".mk-ring .mk-ring-n")`, F14
`getByTestId`) and double-mount app components. The overview therefore shows
caption cards only (number, title, `why`, chips). Thumbnails are a later change.

## D4 Rings
Desktop badge position (−15px, −15px) stays: P1 pins that offset. `.mk-ring`
becomes `inline-flex` so ringed pills stay on one row. In the phone pane
(`body.mk-pane-only`) the badge moves from inside the ring corner (over the
text) to just above the ring (`top:-20px; left:0`) and the pane gets 22px top
padding, so a ring at the top edge keeps its badge inside the iframe (F4) while
width stays exactly 375px (F3).

## D5 Phone pane height
`PhonePane` initial height = `sessionStorage["mk-h:<spec>"]` or 240, plus a
"Loading phone view…" overlay until the first `mkPane` message; each message
stores the height. F3 (height equals content) still holds after load.
