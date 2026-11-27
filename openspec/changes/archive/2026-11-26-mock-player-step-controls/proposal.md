# Proposal: mock-player-step-controls

## Why

The live mock site's scripted-frame player (`packages/mockup-loop/site/`) has three
defects. They break reviewing an animated mock:

1. **A pane scrolls the reviewer's page.** Panes are iframes nested in the site page.
   Scrolling an element into view, including the scroll a bare `focus()` does, scrolls
   every ancestor scrollport, including the reviewer's page. Two sources hit this on
   every loop:
   - **The runner.** The `click` and `type` steps call `user.click`
     (`packages/mockup-loop/site/script.ts:132`, `:136`). user-event's `click` focuses
     the closest focusable with a bare `focus()`.
   - **The mocked component itself.** For example, `CreateAutomationDialog`, when opened
     on a section, calls `scrollIntoView()` and then a bare `focus()`
     (`packages/automation-plugin/src/client/CreateAutomationDialog.tsx:388-398`). A
     runner-only fix cannot reach these calls.

   The shell pauses a scripted pane only when it is fully off-screen, so a partly
   visible pane keeps yanking the page back to itself.
2. **An animated pane grows and pushes the rest of the site around.** `PaneFrame` sets
   the iframe height to the pane's root `scrollHeight` (`packages/mockup-loop/site/Site.tsx:228-234`,
   `:286`). That value never drops below the iframe's own height, so the pane never
   shrinks, but it grows every time a step renders taller than any before. In every first
   loop, each new tallest step moves every frame below it.
3. **Pause has no stepping.** A paused scripted pane can only resume. A reviewer cannot
   walk the interaction one step at a time, forward or back, which is the main reason
   to pause.

## What Changes

- **Pane scroll guard.** A new side-effect module, `site/pane-scroll-guard.ts`, is
  imported first by `site/main.tsx`. In an embedded `?pane=` document:
  - `focus()` (HTML and SVG) always applies `preventScroll: true`, then reveals the
    focused element inside the pane only;
  - `scrollIntoView()` and `scrollIntoViewIfNeeded()` scroll only the pane's own scroll
    containers and the pane window, never the reviewer's page.

  Focus still lands where the runner or component asks. Top-level `?pane=` documents
  (headless check and video) keep native scrolling.
- **Pre-measured fixed stage.** On every page load, an embedded scripted pane first runs
  one fast loop behind its loading line (bounded, no health count), measuring its height
  after each step. It then appears at the tallest height and keeps it. The site never moves
  because of the pane's own steps. Content that turns out taller in the live loop grows
  the stage once, as a fallback; the stage never shrinks.
- **Step controls while paused.** The health bar gets `◀` (Step back) and `▶` (Step
  forward) in a fixed slot. They are shown when the reviewer paused the pane,
  `aria-disabled` while a step or rewind runs, and hidden after a failed loop. They post
  `mkStep: -1 | 1`. The health bar becomes a single non-wrapping line, so its counts and
  errors never move the site.
- **Step gate.** A new framework-free `site/step-gate.ts` (`createStepGate`) is an
  explicit state machine (`playing | held | running | rewinding | stopped`). It replaces
  the inline pause and hidden state (`site/pane-runtime.ts:62-63`) and gates the
  end-of-loop hold. The pane reports its state with `mkGate`.
- **Rewind = remount + silent replay** with no health count, then the same loop
  continues from the landing step (`runSteps` gains `from` and passes the step index to
  its `paused` hook). The pane rests paused with a resting caption.
- **Resting captions.** A held pane's caption names the step it rests after, or reads
  `0/N start`.

No authoring API change: mocks and `Frame`/`ScriptStep` types are untouched. Mocked
components that relied on page-level scrolling now scroll only inside their pane. This
is intentional and documented.

## Capabilities

### Modified Capabilities
- `mockup-live-component-site`:
  - Pane iframe height follows content, except for scripted panes.
  - New requirement: a pane never scrolls the reviewer's page.
- `mockup-site-scripted-interaction`:
  - Pause gains step controls.
  - Captions gain the resting-step rule.
  - New requirement: scripted panes are pre-measured fixed stages.

## Impact

- `packages/mockup-loop/site/script.ts`, `site/pane-runtime.ts`, `site/Site.tsx`,
  `site/main.tsx`, `site/site.css`.
- New: `site/step-gate.ts`, `site/pane-scroll-guard.ts`.
- Docs:
  - `packages/mockup-loop/references/live-mock-site.md` § Scripts.
  - `packages/mockup-loop/.pi/skills/frontend-mockup-loop/SKILL.md` ("Behaviour is
    shown" paragraph).
  - `site/AGENTS.md` rows.
  - Root `CHANGELOG.md` `## [Unreleased]`.
- No server, client, or dashboard runtime impact; mock-site only.

## Discipline Skills

- `systematic-debugging`: the scroll jump and the pane growth are root-caused by
  measurement (host `scrollY`, in-pane `activeElement`, root `scrollHeight` against
  iframe height) before the fix.
- `doubt-driven-review`: the prototype-level `focus` / `scrollIntoView` override changes
  behaviour for every mocked component in an embedded pane. Review it before it stands.
- `review-code`: before commit.
- `code-quality`: `npm run quality:changed` before commit.
