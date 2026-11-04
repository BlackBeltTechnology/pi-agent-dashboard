# Spec Delta

## MODIFIED Requirements

### Requirement: The ceiling and the subagent fan-out bound SHALL be presented as coupled

`Agent` children execute inside the parent session's process, so they share one
V8 heap and one ceiling. A per-child budget is therefore not expressible. The
only lever over subagent memory is the subagents producer's `maxConcurrent`,
set in the subagents plugin settings, which silently becomes a memory-safety
setting once a ceiling is enforced.

The operator SHALL be warned when the pair leaves each concurrent child less
than approximately `100` MB, computed as `maxOldSpaceMb / (maxConcurrent + 1)`.
The `+ 1` accounts for the parent itself. An unlimited `maxConcurrent` (`0`)
under a set ceiling SHALL always warn. The warning SHALL NOT block the save.
Both values remain valid, and the pairing is a risk to disclose rather than an
error.

#### Scenario: A risky pairing is disclosed
- **WHEN** the session ceiling is `512` and `maxConcurrent` is raised to `8`
- **THEN** the operator SHALL be warned that each concurrent child is left under the guidance figure
- **AND** the save SHALL still be permitted

#### Scenario: The shipped pairing is not warned
- **WHEN** the session ceiling is `512` and `maxConcurrent` is the default `4`
- **THEN** no warning SHALL be shown

#### Scenario: Unlimited is disclosed
- **WHEN** the session ceiling is `512` and `maxConcurrent` is `0`
- **THEN** the operator SHALL be warned

#### Scenario: No fallback is reported on the normal path
- **WHEN** every session was spawned through an argument position or a per-window environment
- **THEN** the health endpoint SHALL NOT report the fallback as in use
