# Test Plan — fix-mock-site-ux

Stage: design   Generated: 2026-11-05

Levels: L1 = vitest `packages/mockup-loop/src/__tests__/`; L3 = Playwright
`tests/e2e/mock-site/mock-site.spec.ts` under `playwright.mock-site.config.ts`
(self-started mock site, no docker harness). "example" = the session-pills mock
copied by `makeE2eProject()` from `packages/mockup-loop/examples/`; "fixture" =
the e2e-only mock written by `makeE2eProject()`.

## Scenarios

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| U1 | Example mock ships outside the mock roots | EP | L1 | automated | the repository root | `discoverMocks(repoRoot)` | no entry with id `2026-11-03-session-pills`; `packages/mockup-loop/examples/2026-11-03-session-pills/mock.tsx` exists |
| U2 | Frame steps › side by side | EP | L3 | automated | example frame 3 (3 steps, no `play`) | open `#<example>` | 3 `.mk-step` cards labelled `3a`, `3b`, `3c`; ids `r-<example>/3/proposed/step-1..3` present |
| U3 | Frame steps › deep link | EP | L3 | automated | example | open `#<example>/3/proposed/step-2` | `[id="r-<example>/3/proposed/step-2"]` has class `mk-hit` and is in viewport |
| U4 | Frame steps › animated | state-transition | L3 | automated | fixture frame with 2 steps, `play: true` | open fixture, wait 3 s; then click Pause and wait 3 s | exactly one `.mk-scene.on`; it changes after the first wait; it does not change after Pause |
| U5 | Frame steps › reduced motion | EP | L3 | automated | same fixture frame; context `reducedMotion: "reduce"` | open fixture | no `.mk-player`; the frame renders `.mk-step` cards |
| U6 | Frame steps › steps with panes | EP | L3 | automated | fixture frame with `steps` and `current` | open fixture | `.mk-problems` names the fixture id and frame number; its steps render |
| U7 | Overview › card links to frame | EP | L3 | automated | example (3 frames) | open `#<example>`, click overview card 2 | 3 `.mk-ov-card`; `location.hash` = `#<example>/2` |
| U8 | Frames › frame reason + lint | BVA | L3 | automated | fixture frame 1 `why` = 121 chars; example frame 1 `why` set | open each | example `.mk-why` shows its text; fixture shows `WHY > 120` |
| U9 | Rings › phone badge not over ringed text | EP | L3 | automated | example frame 2, current pane (phone) | read `.mk-ring` and `.mk-ring-n` boxes in the iframe | badge box does not intersect ring box; F4 still passes |
| U10 | Rings › no wrapping | EP | L3 | automated | example frame 1 current, ring 1 around two pills | read the ring's children boxes | both pills share one vertical centre (±1px) |
| U11 | Overview › no mocks | EP | L3 | automated | temp project with both mock dirs moved aside | open site, then restore dirs | text "No mocks yet" and `mockups/<yyyy-mm-dd-slug>/mock.tsx` visible; after restore the fixture is listed again |
| U12 | Frames › phone before first height | EP | L3 | manual-only | example frame 2 on a cold Vite cache | open the page | phone panes show "Loading phone view…" at ≥240px, no blank white jump (timing-dependent; not stable in CI) |

## Regression

All existing `mock-site.spec.ts` tests (F1–F16, P1, E20, X5–X7) and
`packages/mockup-loop` vitest suites MUST pass unchanged apart from the fixture
copy path.
