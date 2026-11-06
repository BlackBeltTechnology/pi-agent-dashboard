## Purpose

Let a mock show behaviour, not only appearance: real clicks, typing and state changes
on real components, visible to the reviewer as an animated, repeatable walkthrough
that also proves the interaction works.

## ADDED Requirements

### Requirement: Frames may declare a script of user interactions
A frame MAY declare `script`, an ordered list of captioned steps, and the side it
drives: proposed (the default), current, or both. Each step targets an element by a
selector (test id first). The runner SHALL perform the step's click, type, clear,
hover, key press or wait on the real rendered DOM of each driven pane. A frame that
declares both `script` and `steps` SHALL be reported as a problem, and the script wins.

#### Scenario: Click and type on a real component
- **WHEN** a frame scripts "click Edit" then "type `0 17 * * *` into the cron field"
- **THEN** the real editor opens and its cron field contains `0 17 * * *` by the component's own input handling

#### Scenario: Script and steps both declared
- **WHEN** a frame declares `script` and `steps`
- **THEN** the page reports the frame as a problem and runs the script

### Requirement: Scripted panes run isolated
Each pane driven by a script SHALL run in its own isolated document on the site's
origin, with its own clock, fixture instance and DOM. Two scripted frames on one page,
or both sides of one frame, SHALL NOT affect each other.

#### Scenario: Two scripted frames on one page
- **WHEN** a page has two scripted frames running at the same time
- **THEN** each completes its own steps, and neither's clicks, typing or fixture writes appear in the other

### Requirement: Step targets resolve with a bounded wait
A step SHALL wait up to a bounded timeout for its target, including content the app
portals out of the pane's root element. The timeout SHALL default to 4000 ms and MAY
be set per step. A target that never appears SHALL fail the
step and name the selector and the step number.

#### Scenario: Missing target
- **WHEN** a step targets a selector that never appears
- **THEN** the run stops at that step and the page shows the step number, caption and selector as the failure

#### Scenario: Late target within the timeout
- **WHEN** a step's target appears 3000 ms after the step starts, with the default timeout
- **THEN** the step succeeds

### Requirement: Steps assert state instead of assuming it
A step MAY declare `unless` (a selector or check): when it holds, the step is skipped.
A step MAY also declare `expect`, which SHALL hold within the step timeout after the
action, or the step fails.

#### Scenario: Toggle already in the wanted state
- **WHEN** a step "switch to raw mode" declares `unless` on the raw input, and the editor opens already in raw mode
- **THEN** the step is skipped and the toggle is not clicked

#### Scenario: Expectation fails
- **WHEN** a step's `expect` does not hold within its timeout
- **THEN** the run fails at that step and names the expectation

### Requirement: Visible cursor and captions
While a script runs, the pane SHALL show a pointer that moves to each target before
its action, a pressed state during clicks, and the current step's caption with its
position (`n/total`). The pointer and caption SHALL stay inside the pane, SHALL NOT
receive pointer events, and SHALL use the project's theme tokens.

#### Scenario: Pointer travels to the target
- **WHEN** a click step runs
- **THEN** the pointer is positioned over the target's center before the click is dispatched

### Requirement: Deterministic time and looping
A frame MAY declare `clockAt`, an ISO-8601 instant; when absent it defaults to the
time the page loaded. A scripted pane's clock SHALL start at `clockAt` on every loop
and advance in real time from there, so relative times render the same on every loop.
Between loops the pane SHALL remount its content with a fresh fixture instance. A
script SHALL loop by default, hold on the final state before restarting, and offer a
pause control. A frame MAY set `loop: false` to stop at the end.

#### Scenario: Fixed relative time
- **WHEN** a fixture run started 18 minutes before the frame's `clockAt`
- **THEN** the component shows "18m ago" at the start of every loop

#### Scenario: Loop resets state
- **WHEN** a loop's script created a run through a stateful fixture
- **THEN** the next loop starts from the original fixture data

### Requirement: Reduced motion shows each step as a live paused pane
When the viewer prefers reduced motion, a scripted frame SHALL NOT animate. It SHALL
render one pane per step, showing the real components paused right after that step,
side by side and labelled with the step caption. Each SHALL be addressable as
`#<id>/<frame>/<side>/step-<k>`.

#### Scenario: Reduced motion
- **WHEN** the page is viewed with `prefers-reduced-motion: reduce`
- **THEN** no pointer animation runs, and one labelled live pane per step shows the state after that step

#### Scenario: Step reference
- **WHEN** `#<id>/1/proposed/step-3` is opened under reduced motion
- **THEN** the page scrolls to and flashes the pane paused after step 3

### Requirement: Script health and video export
Each scripted pane SHALL report completed and failed loop counts. A check command SHALL
run a frame reference headlessly for N loops (default 3) and exit non-zero on any failed loop. An
export command SHALL record one loop of a frame reference to a video file. The default
location is the project's build cache directory, never a committed mock directory, and
an output path can be given. The command SHALL print the video's path.

#### Scenario: Flake check
- **WHEN** the check command runs a frame for 10 loops
- **THEN** it reports completed and failed loop counts and exits non-zero if any loop failed

#### Scenario: Default loop count
- **WHEN** the check command runs without a loop count
- **THEN** it runs 3 loops

#### Scenario: Video export
- **WHEN** the export command runs for a frame reference with no output path
- **THEN** a video of one full loop is written under the project's build cache directory and its path is printed
