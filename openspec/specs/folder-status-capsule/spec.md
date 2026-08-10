# folder-status-capsule Specification

## Purpose
TBD - created by archiving change unify-folder-status-capsule. Update Purpose after archive.
## Requirements
### Requirement: One status capsule is the folder's only liveness surface

The folder header SHALL render exactly one status capsule per folder, replacing the raw session count, the needs-you pill and the collapsed-only status rollup. No other element in the folder header SHALL report session liveness.

The capsule SHALL render in **both** collapse states — expanded and collapsed — so folder liveness does not disappear when the user expands the folder to inspect it.

#### Scenario: Capsule replaces the three counters

- **GIVEN** a folder with 723 sessions, 4 of which need the user
- **WHEN** the folder header renders
- **THEN** a single element with test id `folder-status-capsule-<cwd>` SHALL render
- **AND** no raw `(723)` session count, needs-you pill or separate status rollup SHALL render

#### Scenario: Capsule survives expansion

- **GIVEN** a collapsed folder rendering the capsule
- **WHEN** the user expands the folder
- **THEN** the capsule SHALL remain rendered with the same segments

### Requirement: Capsule segments are severity-ordered

Segments SHALL render in the fixed order **needs-you > error > working > idle**. A human actively waiting outranks a crash: the crash is already over, the wait is not. The order SHALL NOT vary with segment magnitude.

#### Scenario: Needs-you precedes error

- **GIVEN** a folder with 1 session needing the user and 9 errored sessions
- **WHEN** the capsule renders
- **THEN** the needs-you segment SHALL render before the error segment

#### Scenario: Idle is always last

- **GIVEN** a folder with idle, working and error sessions
- **WHEN** the capsule renders
- **THEN** the idle segment SHALL be the trailing segment

### Requirement: Non-idle segments are individual navigation targets; idle is inert

Each non-idle segment SHALL be a `<button>` with a distinct accessible label naming its count and state (for example "4 sessions blocked on you — go to first"). The trailing idle segment SHALL be inert: a non-focusable element that is not a button (a *disabled* button is still announced as an unavailable control), carrying no activation handler. The idle segment SHALL still carry an accessible label naming its state, so it is not announced as a bare number.

Activating a segment SHALL: stop event propagation so the folder-header row's own click handler does not also fire; expand the folder when it is collapsed; select the target session; and scroll it into view **after the expansion has committed**, so the scroll does not no-op against a body that has not yet mounted.

The target SHALL be the first session of that state in **the same ordered list the capsule counts** — the folder's own session order, minus the exclusions below. Counting and targeting SHALL NOT use different lists. Ended, hidden and widget-bar-blocked sessions SHALL never be a target.

Segments SHALL carry test ids `folder-capsule-seg-{needs-you,working,error,idle}-<cwd>`, matching the hyphenation already used by the `needs-you` status shape and the `--status-needs-you` token.

When the target is not currently rendered (for example the active search or tag filter excludes it), activation SHALL degrade through the folder list's existing reveal path, surfacing that path's existing filtered-target notice rather than silently doing nothing.

#### Scenario: Segment activation navigates

- **GIVEN** a capsule with an error segment counting 2 sessions
- **WHEN** the user activates `folder-capsule-seg-error-<cwd>`
- **THEN** the first errored session in the same ordered list the capsule counted SHALL be selected and scrolled into view

#### Scenario: Activation on a collapsed folder expands it first

- **GIVEN** a collapsed folder rendering a capsule
- **WHEN** the user activates a non-idle segment
- **THEN** the folder SHALL expand before the target session is selected
- **AND** the target SHALL be scrolled into view only after the expanded body has mounted

#### Scenario: Segment activation does not toggle the row

- **GIVEN** a folder header row whose own click handler navigates to the directory home
- **WHEN** the user activates a capsule segment
- **THEN** the row handler SHALL NOT fire

#### Scenario: Ended sessions are never a navigation target

- **GIVEN** a folder whose only errored session has ended
- **WHEN** the capsule renders
- **THEN** no error segment SHALL render

#### Scenario: Idle segment is not a target

- **WHEN** the capsule renders an idle count
- **THEN** the idle segment SHALL NOT be focusable and SHALL NOT respond to activation

### Requirement: Ended, hidden and widget-bar sessions are excluded before any bucketing

The capsule SHALL exclude, **before** deriving any status shape:

- sessions whose status is `ended` — shape derivation short-circuits on the notice flag ahead of the status check, so deriving first and filtering after would bucket an ended-but-noticed session as live;
- **hidden** sessions — they are not rendered, so counting one advertises a navigation target that does not exist;
- `ask_user` sessions whose pending prompt is widget-bar-placed, **and those not yet classified** — see the needs-you requirement below.

#### Scenario: Ended session with a pending notice is not counted

- **GIVEN** a session whose status is `ended` and whose notice flag is still set
- **WHEN** the capsule counts
- **THEN** that session SHALL NOT appear in any segment

#### Scenario: Hidden sessions are not counted

- **GIVEN** a folder whose session list includes hidden sessions
- **WHEN** the capsule counts
- **THEN** hidden sessions SHALL NOT appear in any segment

### Requirement: Needs-you is counted by an explicit predicate, not by shared shape derivation

The needs-you count SHALL be computed as: `currentTool === "ask_user"` AND the session is not ended AND the session is **not** in an error state AND its widget-bar classification is **explicitly** "not widget-bar". A session whose classification has not yet resolved SHALL be excluded until it does, so the count never flashes high on mount.

The error exclusion is required for parity with the shared derivation, which checks the error flag **before** the needs-you check. Omitting it counts an errored `ask_user` session in both the needs-you and error segments, and makes the needs-you segment navigate to a session whose card dot is red.

The capsule SHALL NOT obtain needs-you by passing the widget-bar classification into the shared status-shape derivation: that path defaults an unresolved classification to "not widget-bar" and would count the very sessions this rule excludes.

A widget-bar-blocked or unclassified `ask_user` session SHALL be excluded from **every** segment — not merely from needs-you. It SHALL NOT fall through to the idle segment, which would report a session awaiting the user's input as an all-clear.

#### Scenario: Unclassified candidate is excluded until its classification resolves

- **GIVEN** a folder with one `ask_user` session whose widget-bar classification has not yet reported
- **WHEN** the capsule renders
- **THEN** that session SHALL NOT be counted in needs-you
- **AND** SHALL NOT be counted in any other segment

#### Scenario: Widget-bar-placed prompt is not reported as idle

- **GIVEN** a session blocked on an `ask_user` prompt placed in the widget bar
- **WHEN** the capsule renders
- **THEN** that session SHALL NOT be counted in the idle segment

#### Scenario: An errored ask_user session counts once, as error

- **GIVEN** a session whose `currentTool` is `ask_user` and which is also in an error state
- **WHEN** the capsule renders
- **THEN** it SHALL be counted in the error segment only
- **AND** SHALL NOT be counted in the needs-you segment

### Requirement: A noticed session counts as idle

A session carrying a non-error notice SHALL be counted in the idle segment. Supplying the status flags makes the shared derivation reach its `notice` shape, which has no segment of its own; the capsule SHALL map that shape to `idle` rather than dropping it, preserving the count the flagless derivation produces today.

#### Scenario: Notice does not vanish from the count

- **GIVEN** a folder with one idle session carrying a notice and no other sessions
- **WHEN** the capsule renders
- **THEN** an idle segment counting 1 SHALL render

### Requirement: A retrying session counts as working

A session that is retrying SHALL be counted in the working segment, not the error segment: it is actively doing something and has not yet failed. This matches the shared status-shape derivation, which already treats retrying as working.

#### Scenario: Retry is working, not error

- **GIVEN** a folder with one retrying session and no other live sessions
- **WHEN** the capsule renders
- **THEN** a working segment counting 1 SHALL render
- **AND** no error segment SHALL render

### Requirement: Empty segments do not render

A segment whose count is zero SHALL be absent. A folder with only idle sessions SHALL render a capsule consisting of the single inert idle count. A folder with no countable sessions after the exclusions above SHALL render no capsule — including a folder whose sessions have all ended, whose size remains reported by the folder's existing `N ended` disclosure row.

#### Scenario: Only-idle folder

- **GIVEN** a folder with 12 idle sessions and nothing else
- **WHEN** the capsule renders
- **THEN** only the inert idle segment SHALL render

#### Scenario: Empty folder renders no capsule

- **GIVEN** a folder with zero sessions
- **WHEN** the folder header renders
- **THEN** no `folder-status-capsule-<cwd>` element SHALL render

#### Scenario: All-ended folder renders no capsule

- **GIVEN** a folder whose sessions have all ended
- **WHEN** the folder header renders
- **THEN** no capsule SHALL render
- **AND** the folder's `N ended` disclosure row SHALL continue to report them

### Requirement: Segment counts are capped at four glyphs

A segment count SHALL render at most four glyphs: counts above 999 SHALL render as `999+`. The capsule is non-shrinking and never wraps, so an uncapped count on a large folder would push the header past its width budget at narrow sidebar widths.

#### Scenario: Count below the cap renders exactly

- **GIVEN** a segment counting 999 sessions
- **WHEN** the capsule renders
- **THEN** the segment SHALL read `999`

#### Scenario: Count above the cap is truncated

- **GIVEN** a segment counting 1000 sessions
- **WHEN** the capsule renders
- **THEN** the segment SHALL read `999+`

### Requirement: Counting is linear in the folder's session count

The counting pass SHALL visit each session a bounded number of times, so a large folder does not degrade the sidebar. For a folder of 1000 sessions the pass SHALL complete within 5 ms. The threshold is a guard against an accidental quadratic pass (for example a per-session scan of the widget-bar map), not a tuned performance target.

#### Scenario: Large folder counts within budget

- **GIVEN** a folder of 1000 sessions spanning every status
- **WHEN** the counting pass runs
- **THEN** it SHALL complete within 5 ms

### Requirement: Capsule uses the session-status token family, not the message-severity family

Segment colours SHALL be drawn from the existing semantic session-status tokens `--status-{needs-you,working,idle,error}`, which are the same tokens the SessionCard dot and the outgoing pill/rollup consume, keeping the capsule in lockstep with the per-card dot for the same session.

The capsule SHALL NOT use the `--severity-*` triples: those are the message/toast-and-banner colour source of truth, they carry no needs-you (purple) member, and their warning tier is orange where session `working` is yellow — following them would make the capsule disagree with the card dot for the same session.

No new CSS custom property SHALL be added for the capsule.

#### Scenario: Colours come from the status family

- **WHEN** the capsule renders its working segment
- **THEN** its colour SHALL resolve from the `--status-working` custom property
- **AND** SHALL reference the same custom property the working session-card dot references (token identity, not rendered-pixel equality — the segment may tint it as the outgoing pill does)

#### Scenario: No new token is introduced

- **WHEN** the capsule renders any segment
- **THEN** no CSS custom property added by this change SHALL be required

