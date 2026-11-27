## MODIFIED Requirements

### Requirement: Visible cursor and captions
While a script runs, the pane SHALL show a pointer that moves to each target before
its action, a pressed state during clicks, and the current step's caption with its
position (`n/total`). The pointer and caption SHALL stay inside the pane, SHALL NOT
receive pointer events, and SHALL use the project's theme tokens. While the pane is
held, the caption SHALL name the step the pane rests after (`k/total` with that step's
text), or read `0/total start` when no step has run in the current loop. Steps skipped
by `unless` SHALL count toward `k`.

#### Scenario: Pointer travels to the target
- **WHEN** a click step runs
- **THEN** the pointer is positioned over the target's center before the click is dispatched

#### Scenario: Paused caption at the start
- **GIVEN** a scripted pane paused before its first step
- **WHEN** the reviewer reads the caption
- **THEN** it reads `0/total start`

### Requirement: Deterministic time and looping
A frame MAY declare `clockAt`, an ISO-8601 instant; when absent it defaults to the
time the page loaded. A scripted pane's clock SHALL start at `clockAt` on every loop
and advance in real time from there, so relative times render the same on every loop.
Between loops the pane SHALL remount its content with a fresh fixture instance. A
script SHALL loop by default, hold on the final state before restarting, and offer a
pause control. A frame MAY set `loop: false` to stop at the end.

While the reviewer has paused the pane, it SHALL offer Step forward and Step back
controls.
- Step forward SHALL run exactly one more step and stay paused. At the end of a looping
  script it SHALL remount to the start; at the end of a `loop: false` script it SHALL do
  nothing.
- Step back SHALL return the pane to the state after one step fewer by remounting with
  a fresh fixture instance and clock and replaying the earlier steps without animation.
  A replay SHALL NOT change the loop counts unless a replayed step fails, which counts
  as one failed loop.
- Showing, disabling or hiding the controls, and changes to the loop counts or error
  text, SHALL NOT change the height of the frame's pane or its control bar.

#### Scenario: Fixed relative time
- **WHEN** a fixture run started 18 minutes before the frame's `clockAt`
- **THEN** the component shows "18m ago" at the start of every loop

#### Scenario: Loop resets state
- **WHEN** a loop's script created a run through a stateful fixture
- **THEN** the next loop starts from the original fixture data

#### Scenario: Step forward while paused
- **GIVEN** a paused 3-step script resting after step 1
- **WHEN** the reviewer activates Step forward
- **THEN** step 2 runs, the caption reads `2/3 …`, and the pane stays paused

#### Scenario: Step forward at the end of a looping script
- **GIVEN** a paused looping 3-step script resting after step 3
- **WHEN** the reviewer activates Step forward
- **THEN** the pane remounts from the original fixture data, the caption reads `0/3 start`, and the pane stays paused

#### Scenario: Finished one-shot script can still step back
- **GIVEN** a `loop: false` 3-step script that has finished
- **WHEN** the reviewer pauses and activates Step back
- **THEN** the pane shows the state after step 2 and the caption reads `2/3 …`

#### Scenario: Step back while paused
- **GIVEN** a paused 3-step script resting after step 2, where step 2 navigated away
- **WHEN** the reviewer activates Step back
- **THEN** the pane shows the state after step 1 from fresh fixture data, the caption reads `1/3 …`, the pane stays paused, and the loop counts are unchanged

#### Scenario: Step back at the start
- **GIVEN** a paused script resting at the start
- **WHEN** the reviewer activates Step back
- **THEN** the pane stays at the start and the caption reads `0/total start`

#### Scenario: Step back while a step runs
- **GIVEN** a pane resting after step 1 that was stepped forward, so step 2 is still running
- **WHEN** the reviewer activates Step back before step 2 ends
- **THEN** after step 2 ends the pane rewinds to the state after step 1, and the caption reads `1/3 …`

#### Scenario: Repeated Step forward while a step runs
- **GIVEN** a paused pane whose step is still running
- **WHEN** the reviewer activates Step forward three times before that step ends
- **THEN** exactly one further step runs after it, and the pane stays paused

#### Scenario: Controls disabled while busy
- **GIVEN** a paused pane rewinding several steps
- **WHEN** the reviewer looks at the controls during the replay
- **THEN** Step forward and Step back are marked disabled, keep keyboard focus, and presses are ignored

#### Scenario: Long error does not move the site
- **GIVEN** a scripted pane whose loop fails with a long error message
- **WHEN** the error is shown in the control bar
- **THEN** the bar stays one line high and the frames below do not move

#### Scenario: Controls hide after a failed loop
- **GIVEN** a scripted pane whose loop failed
- **WHEN** the reviewer pauses it
- **THEN** no Step forward or Step back control is shown

#### Scenario: Hidden pane does not step
- **GIVEN** a paused pane with a step queued, scrolled fully off-screen
- **WHEN** the queued step would run
- **THEN** it waits until the pane is visible again

#### Scenario: Off-screen pane shows no step controls
- **GIVEN** a playing scripted pane that is held only because it is fully off-screen
- **WHEN** the reviewer scrolls it partly into view before it resumes
- **THEN** no Step forward or Step back control is shown

#### Scenario: Step message from a foreign window
- **WHEN** a step message reaches a pane from a window other than its `parent`, or fails the site's origin check
- **THEN** the pane ignores it

## ADDED Requirements

### Requirement: Scripted panes are pre-measured fixed stages
On each page load, an embedded scripted pane (its side driven by the frame's script,
`loop: false` included; `step-k` panes and top-level documents excluded) SHALL first
run its script once behind its loading line, without counting health, and SHALL appear
at the tallest height measured after mount and each step. Its own steps SHALL NOT change that height, except
to grow when live content is taller. It SHALL never shrink while the page is open.

#### Scenario: Site does not move while the script loops
- **GIVEN** a scripted pane whose content grows at one step and collapses at a later step
- **WHEN** the pane first appears and its script loops
- **THEN** the pane's height equals the tallest step's content height from its first visible loop on, and the frames below it do not move

#### Scenario: Loading line while measuring
- **GIVEN** a scripted pane on a freshly loaded page
- **WHEN** the pane is measuring
- **THEN** it shows a loading line at the last height seen for that pane in this browser session, else 240px, and no step is visible

#### Scenario: Edited mock re-measures
- **GIVEN** a scripted pane whose tallest step was made shorter in the mock
- **WHEN** the page is reloaded
- **THEN** the pane's height is the new tallest content height

#### Scenario: Failing step during measurement
- **GIVEN** a script whose second step fails
- **WHEN** the pane measures
- **THEN** the pane appears at the tallest height measured before the failure, and the visible loop shows the failure

#### Scenario: Live content taller than measured
- **GIVEN** a scripted pane whose live loop renders taller than any measured step
- **WHEN** that step renders
- **THEN** the pane grows to fit and never shrinks afterwards

#### Scenario: Typed step is measured
- **GIVEN** a script whose step types into a field that opens a taller suggestion list
- **WHEN** the pane measures and then loops
- **THEN** the stage includes the open list and the pane does not grow in the visible loops

#### Scenario: Measurement is bounded
- **GIVEN** a script whose steps together wait longer than the measuring budget
- **WHEN** the pane measures
- **THEN** the pane appears when the budget runs out, at the tallest height measured so far

#### Scenario: Deep link to a ring in a scripted pane
- **WHEN** the site opens at a reference to a ring inside a scripted pane
- **THEN** after the pane appears, the top page scrolls so that ring is in view and the ring is highlighted

#### Scenario: Reduced-motion step panes follow their content
- **GIVEN** a scripted frame shown with reduced motion, as one paused pane per step
- **WHEN** a step pane's content height changes
- **THEN** that pane's height follows its content
