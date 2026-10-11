## ADDED Requirements

### Requirement: Transition camera motions
On navigation the runtime SHALL move the camera from its current pose to the arriving slide's anchor using the
arriving slide's resolved transition and `durationSec`. Every flying kind SHALL end with the camera exactly at the
anchor's camera position, looking at its target, with zero roll and the deck field of view. `dolly` SHALL be a
straight eased move and `swing` SHALL keep its current sideways arc (both unchanged from before this change).
`revolve` SHALL arc around the arriving slide's target, `crane` SHALL rise above the straight line by mid-move and
descend onto the slide, `bank` SHALL roll the camera into the move and back out (|roll| ≤ 8° by default),
`flythrough` SHALL pass low through the gap with a gentle bank. `fade` SHALL cover the screen with the palette
background colour, switch the camera while fully covered, and uncover; `iris` SHALL do the same with a circular
mask closing to the centre and reopening. `cut` SHALL snap instantly. `path` SHALL follow the slide's
`cameraPath`: keys mapped into the travel frame (from-camera → to-camera, offsets × travel length), joined by a
centripetal Catmull-Rom curve with the start and end pinned, sampled by arc length at the eased time, with
`look`, `roll` and `fov` interpolated between keys.

#### Scenario: Path lands exactly
- **WHEN** a slide with `transition: "path"` and a three-key `cameraPath` is entered and the duration elapses
- **THEN** the camera position equals that slide's anchor camera position and its roll is 0

#### Scenario: Crane rises
- **WHEN** a `crane` move is sampled at its mid-point
- **THEN** the camera is higher than the straight line between start and end

#### Scenario: Fade covers the jump
- **WHEN** a `fade` move is captured at its mid-point
- **THEN** the frame is filled with the palette background colour

### Requirement: Transition motions are deterministic and reversible
A motion SHALL be a pure function of (kind, params, from pose, to pose, normalised time), computed when the move
starts. Under `setTime` two renders of the same deck at the same slide and time SHALL produce the same camera
pose. Navigating backwards from slide n to n−1 SHALL play slide n's motion in reverse (same curve, time 1→0).
For the whole move both the leaving and the arriving slide groups SHALL stay visible regardless of the neighbour
cull radius; other slides keep culling.

#### Scenario: Back mirrors forward
- **WHEN** the camera pose of slide 2→3 at u = 0.3 is compared with the pose of 3→2 at u = 0.7
- **THEN** the two poses are equal

#### Scenario: Wide path keeps both slides
- **WHEN** a `revolve` move swings the camera farther than the cull radius from both slides
- **THEN** both slide groups remain visible until the move lands

### Requirement: Slides cross-fade during a move
During every flying move the leaving slide's backdrop (local effects and background) SHALL fade out and the
arriving slide's backdrop SHALL fade in, by scaling material opacity (or an `opacity` uniform) without cloning
materials; a slide that is culled before (arriving) or after (leaving) the move SHALL fade as a whole group.
Opacity an effect writes itself SHALL compose with the fade, and every material SHALL get its own opacity and
transparency back when the move lands. Camera-pinned overlays that left the slide group SHALL NOT be faded.

#### Scenario: No flash at landing
- **WHEN** a move lands and the leaving slide's local effects are disposed
- **THEN** they were already fully faded out, so nothing disappears abruptly

#### Scenario: No pop-in of the arriving slide
- **WHEN** a move starts and the arriving slide's local effects are created
- **THEN** they start fully transparent and fade in during the move
