# chat-motion Specification

## Purpose
Defines how the live chat transcript moves while an agent works: which elements animate on arrival, how streamed text is revealed and softened, how the view follows new content, and how tool completion is shown. All of it can be switched off, respects reduced motion, never hides content, and costs nothing while the transcript is quiet.

## Requirements

### Requirement: Chat motion is controlled by a display preference

The chat view SHALL expose a `chatMotion` display preference (boolean, default `true`) at a GLOBAL scope (Settings chat-display section, applied on Save) and a per-session OVERRIDE scope (`ChatViewMenu` View popover, applied instantly). The effective value SHALL be `mergeDisplayPrefs(global, override)`. Every `DISPLAY_PRESETS` entry SHALL define the field. A stored `displayPrefs` lacking it SHALL be backfilled to `true`. A display-prefs PATCH that omits it SHALL preserve the stored value.

#### Scenario: Default is on
- **GIVEN** a `DisplayPrefs` object with no explicit `chatMotion`
- **WHEN** it is loaded or merged from a preset
- **THEN** the effective `chatMotion` SHALL be `true`

#### Scenario: Legacy preferences file is backfilled
- **GIVEN** a persisted `preferences.json` whose `displayPrefs` has no `chatMotion`
- **WHEN** the preferences store loads it
- **THEN** `chatMotion` SHALL be `true` before it reaches any client, and no client SHALL observe it as `undefined`

#### Scenario: Partial PATCH preserves the field
- **GIVEN** a stored `chatMotion = false`
- **WHEN** `PATCH /api/preferences/display` updates a different field and omits `chatMotion`
- **THEN** the stored and broadcast `chatMotion` SHALL remain `false`

#### Scenario: Per-session override wins
- **GIVEN** global `chatMotion = true` and a session override `chatMotion = false`
- **WHEN** that session receives a streaming answer
- **THEN** that session SHALL show no chat motion, while other sessions keep it

### Requirement: Motion is inactive under reduced motion, a hidden document, or the preference off

Chat motion SHALL be active only when the effective `chatMotion` is `true`, the user agent does not report `prefers-reduced-motion: reduce`, and the document is visible. When motion is inactive, the transcript SHALL behave exactly as it does without this capability:
- elements appear without transition;
- applied streaming text is shown on the next paint;
- the follow-scroll pin is instant;
- no trailing-edge softening or completion cue is shown.

#### Scenario: Reduced motion overrides the preference
- **GIVEN** effective `chatMotion = true` and `prefers-reduced-motion: reduce`
- **WHEN** elements arrive and text streams
- **THEN** no entry transition, paced reveal, trailing-edge softening, glide or completion cue SHALL occur

#### Scenario: Motion off equals today
- **GIVEN** effective `chatMotion = false`
- **WHEN** a streamed chunk is applied to the session state
- **THEN** the full applied text SHALL be visible on the next paint and the follow pin SHALL land at the bottom in the same frame

#### Scenario: Hidden document shows everything on return
- **GIVEN** motion is otherwise active, no selection is held, and the document becomes hidden while text streams and elements arrive
- **WHEN** the document becomes visible again
- **THEN** all received text and arrived elements SHALL already be fully visible, with no catch-up reveal and no pending entry transition

### Requirement: Only newly arriving live elements play an entry transition

While motion is active and the view is following the bottom, these elements SHALL play a brief entry transition (fade in with a small vertical offset, at most 300 ms) when they first appear:
- the optimistic pending-prompt card;
- a pending steering card;
- a tool call's first appearance, as its own row or as a new line inside an existing group;
- the streaming answer or live reasoning bubble on its first content.

An element SHALL play this transition at most once per session view. In a host that does not indicate when history load or replay is in progress, no entry transitions SHALL play. These SHALL never play an entry transition:
- elements present when the session is first shown;
- elements that arrive during history load or replay, or as part of a single update that adds more than four new elements;
- elements that arrived while the session was not shown or while motion was inactive;
- elements that arrive while the view is scroll-locked, a selection is held, or motion is inactive;
- elements remounted by scrolling or virtualization;
- a group formed from already-visible members;
- committed user, assistant, and reasoning message rows.

#### Scenario: Live tool call animates in
- **GIVEN** motion is active and the user is following the bottom
- **WHEN** a live tool call starts
- **THEN** its row SHALL fade and rise into place once

#### Scenario: Scrolling back does not replay entries
- **GIVEN** rows that arrived live earlier in the session
- **WHEN** the user scrolls so those rows unmount and later remount
- **THEN** no remounted row SHALL play an entry transition

#### Scenario: Off-screen arrival does not animate later
- **GIVEN** the user is scroll-locked away from the bottom
- **WHEN** a tool row arrives and the user scrolls down to it
- **THEN** the row SHALL appear without an entry transition

#### Scenario: Grouping does not re-animate visible rows
- **GIVEN** two identical completed tool rows on screen
- **WHEN** a third identical call completes and the rows are combined into a group
- **THEN** the group SHALL appear without an entry transition

#### Scenario: Session view and replay do not animate
- **WHEN** a session is opened, switched to (including returning to a session after tool calls arrived while it was not shown), or replayed
- **THEN** none of its existing or replayed elements SHALL play an entry transition

#### Scenario: Commit swaps do not animate
- **GIVEN** a visible streaming bubble or a visible optimistic pending-prompt card
- **WHEN** the committed message or the server-confirmed user message replaces it
- **THEN** the replacement SHALL NOT play an entry transition and SHALL cause no layout shift

### Requirement: Streamed text is revealed at a paced, bounded-lag rate

While motion is active and the view is following the bottom, received text for the streaming answer and for an expanded live reasoning block shown inline in the transcript SHALL be revealed progressively on display frames rather than in received bursts. While the view is scroll-locked away from the bottom, received text SHALL be shown as it is applied. The reveal SHALL bound its lag: with text arriving in steady bursts, every received character SHALL be visible within 500 ms of its arrival. After a stall followed by a large delivery, the delivery SHALL be fully visible within 500 ms. The revealed text SHALL show all received text immediately when the unrevealed backlog exceeds a catch-up threshold, or when the revealed text is no longer a prefix of the received text.

While a selection is held inside the streaming answer bubble, its revealed text SHALL NOT change until the selection collapses. While motion is active, the same SHALL hold for a selection inside a paced live reasoning block, until the selection collapses or the block completes. This takes precedence over every other rule, including a hidden document. When the selection collapses, all text received more than 500 ms earlier SHALL become visible immediately. When the stream ends with no selection held, the committed message SHALL show its full content immediately.

#### Scenario: Bursts become a steady flow
- **GIVEN** motion is active and text arrives in 50 ms coalesced bursts
- **WHEN** the streaming bubble renders
- **THEN** visible text SHALL grow across consecutive display frames between bursts, and every received character SHALL be visible within 500 ms of its arrival

#### Scenario: Stall dump catches up quickly
- **GIVEN** no text has arrived for 600 ms
- **WHEN** a 400-character delivery arrives
- **THEN** the full delivery SHALL be visible within 500 ms

#### Scenario: Selection freezes the reveal
- **GIVEN** the user holds a selection inside the streaming bubble
- **WHEN** further text arrives or the document is hidden
- **THEN** the bubble's text SHALL not change until the selection collapses

#### Scenario: Selection in live reasoning freezes its reveal
- **GIVEN** motion is active and the user holds a selection inside a paced live reasoning block
- **WHEN** further reasoning text arrives before the block completes
- **THEN** the block's text SHALL not change until the selection collapses

#### Scenario: Reveal growth is followed
- **GIVEN** the user is following the bottom
- **WHEN** revealed text wraps onto a new line between received bursts
- **THEN** the view SHALL follow that growth to the bottom

#### Scenario: Collapsed reasoning is not paced
- **GIVEN** a live reasoning block that is collapsed, or shown in its capped scroll area rather than inline
- **WHEN** reasoning text arrives
- **THEN** no reveal pacing work SHALL run for that block and the text SHALL be shown as it is applied

### Requirement: Freshly revealed text has a soft trailing edge

While motion is active and text is being revealed, the newest glyphs at the reveal point on the last prose line SHALL appear softened, and SHALL become fully crisp as the reveal advances. When the reveal pauses or ends, the softening SHALL fade away, so settled text is never obscured. The softening SHALL NOT be applied over code blocks, diagrams, or math. It SHALL NOT alter the rendered text, links, selection, or copy result.

#### Scenario: Softening never persists
- **GIVEN** text is being revealed
- **WHEN** no further text arrives, or the stream ends
- **THEN** no part of the bubble's text SHALL remain softened 700 ms after the last text arrived

#### Scenario: Links render during streaming
- **GIVEN** motion is active and the streamed prose contains a file path
- **WHEN** the path is fully revealed
- **THEN** it SHALL be linkified exactly as it is with motion off

### Requirement: Following the bottom glides for live growth and stays instant for relocations

While motion is active and the view is following the bottom, transcript growth caused by live content or by revealing text SHALL be followed with a smooth glide, provided the growth is at most one viewport height. The view SHALL come to rest at the bottom once growth stops. Intermediate glide positions SHALL NOT be treated as the user scrolling away: they SHALL NOT release follow and SHALL NOT show the scroll-to-bottom button.

These SHALL remain instant, exactly as today: growth larger than one viewport height, session switch, scroll restore, history replay or backfill, jump-to-message, scroll-to-top, any pin while a selection is held, and the scroll-to-bottom button's own scroll.

Any scroll movement not produced by the glide itself (scrollbar drag, keyboard scrolling, find-in-page, autoscroll), and any wheel or touch input, SHALL end the glide immediately. Scroll lock then follows the existing position-based rules: a movement away from the bottom engages lock, and the glide SHALL NOT pull the view back. Motion becoming inactive during a glide SHALL end it with an instant pin to the bottom. The glide SHALL settle within 500 ms of the last growth.

#### Scenario: Live growth glides
- **GIVEN** motion is active and the user is following the bottom
- **WHEN** a tool row arrives below the visible area
- **THEN** the scroll position SHALL approach the bottom over several frames and settle there, with follow still engaged

#### Scenario: Wheel-up during the glide wins
- **GIVEN** a glide is in progress
- **WHEN** the user scrolls up with the wheel past the near-bottom threshold
- **THEN** the glide SHALL stop immediately, scroll lock SHALL engage, and the view SHALL not move back down while content keeps streaming

#### Scenario: Scrollbar drag during the glide wins
- **GIVEN** a glide is in progress
- **WHEN** the user drags the scrollbar upward
- **THEN** the glide SHALL stop and SHALL not fight the drag, and scroll lock SHALL engage

#### Scenario: Relocation during the glide is not pulled back
- **GIVEN** a glide is in progress
- **WHEN** the user jumps to an earlier message or switches session
- **THEN** the relocation SHALL land instantly and no further glide step SHALL move the view

#### Scenario: Keyboard scrolling during the glide wins
- **GIVEN** a glide is in progress and focus is inside the transcript
- **WHEN** the user presses Page Up
- **THEN** the glide SHALL stop, scroll lock SHALL engage, and the view SHALL not move back down while content keeps streaming

#### Scenario: Large growth jumps
- **GIVEN** the user is following the bottom
- **WHEN** a single update grows the transcript by more than one viewport height
- **THEN** the view SHALL pin to the bottom instantly

### Requirement: Live tool completion shows a one-shot cue

While motion is active and the view is following the bottom, when a tool call on screen transitions live from running to completed (successfully or with an error), its status icon SHALL appear with a scale/opacity cue lasting at most 300 ms. Any result body revealed by that completion SHALL fade in. The cue SHALL NOT change layout timing: content takes its final size immediately. It SHALL NOT play for tools that were already completed when they mounted (replay, remount, scroll-back), for completions applied during history load or replay or within a bulk update, in a host that does not indicate replay, or when the user later expands a completed tool.

#### Scenario: Completed tool shows a one-shot cue
- **GIVEN** a running tool row on screen
- **WHEN** the tool completes live
- **THEN** the status icon SHALL pop in once and a newly shown result body SHALL fade in

#### Scenario: Remounted completed tool has no cue
- **WHEN** a completed tool row is mounted by replay or scrolling
- **THEN** no completion cue SHALL play

### Requirement: Motion never hides content or gates behaviour

Every element's resting state SHALL be its fully visible static style. Motion SHALL NOT leave content hidden, softened, or partially transparent after its bounded duration, including while CSS animations are paused (document hidden, user idle) or the element is off-screen. No functional behaviour SHALL depend on motion running or completing; this covers scroll lock, selection, copy, linkification, and commit swaps. Two cases are not hidden content: the pre-existing buffering of streamed text while a streaming-bubble selection is held, and received text still within the paced-reveal window (at most 500 ms), which becomes visible within that window.

#### Scenario: Idle mark does not freeze arriving content
- **GIVEN** the document root carries the idle animation-pause mark
- **WHEN** a tool row and streamed text arrive
- **THEN** the row and the text SHALL become fully visible

#### Scenario: Behaviour does not wait for motion
- **GIVEN** an element whose entry transition is still running
- **WHEN** the user scrolls up, selects text, or copies
- **THEN** scroll lock, selection, and copy of the visible text SHALL behave exactly as with motion off

#### Scenario: Entry does not move a held selection
- **GIVEN** the user is dragging a selection in the transcript
- **WHEN** a new element arrives
- **THEN** it SHALL appear without an entry transition

### Requirement: Motion costs nothing while the transcript is quiet

Motion SHALL animate only `opacity` and `transform`. When no text is being revealed and no glide is moving, the chat view SHALL schedule no per-frame work for motion.

#### Scenario: Quiet transcript schedules no frames
- **GIVEN** motion is active and streaming has ended
- **WHEN** no events and no input occur for 10 s
- **THEN** the chat view SHALL schedule no animation-frame callbacks for motion during that period
