## ADDED Requirements

### Requirement: Skill documents camera motions
The deck3d skill SHALL list every transition id with a one-line description of the move, explain per-slide
`transition`/`durationSec`, deck-level `transitionCycle`, and `cameraPath` (travel-frame offsets as fractions of
the travel length, implied pinned endpoints, `look`/`roll`/`fov`, reverse playback on back navigation), and SHALL
include one worked `cameraPath` example. It SHALL warn that camera-pinned local effects tilt with `roll`.

#### Scenario: Agent picks a motion from the skill
- **WHEN** an agent reads the skill to vary slide changes
- **THEN** it finds the id list, the `transitionCycle` field and a `cameraPath` example it can paste into `deck.json`
