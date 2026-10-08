# card-visual-effects Specification

## Purpose
Lets users switch off decorative card animations (animated status gradients, selected-card glow ring) as ordinary global settings, independent of Focus mode, without losing the status meaning they convey.

## Requirements

### Requirement: Effect switches

Global settings SHALL include an `Effects` group with two on/off switches, both on by default:
- `fx-status-animation` — the animated status gradients / stripes on session cards (running, unread, needs-input);
- `fx-selected-glow` — the rotating glow ring on the selected session card.

The values SHALL persist server-side with the global card-section defaults and sync to every browser. They SHALL be global only: the per-folder Session cards page SHALL NOT offer them, resolution SHALL ignore any folder override for these ids, and the server SHALL reject a folder-scoped write for them without mutating state. While Focus mode is on, a focus profile value for these ids SHALL take precedence.

#### Scenario: Turn off animated gradients
- **GIVEN** `fx-status-animation` on and a streaming session
- **WHEN** the user switches `fx-status-animation` off
- **THEN** that session's card SHALL show no animated gradient or stripe
- **AND** other browsers SHALL apply the change without reload

#### Scenario: Folder-scoped effect write rejected
- **WHEN** a browser sends a visibility message for `fx-status-animation` with folder path `/a`
- **THEN** preferences SHALL NOT change and no broadcast SHALL occur

#### Scenario: Turn off selected glow only
- **WHEN** the user switches `fx-selected-glow` off and leaves `fx-status-animation` on
- **THEN** the selected card SHALL show no rotating glow ring
- **AND** unread / running cards SHALL keep their animated status gradients

### Requirement: Flat fallback preserves meaning

When an effect is off, the card SHALL still convey the same state through a static cue: running, unread and needs-input cards SHALL show a static tint in their state color (yellow, cyan, purple), and the selected card SHALL keep a static selected border. Turning effects off SHALL NOT change any status color, icon or text.

#### Scenario: Unread still distinguishable
- **GIVEN** `fx-status-animation` off
- **WHEN** a session becomes unread
- **THEN** its card SHALL show the unread status color statically
- **AND** no animation SHALL run on that card

#### Scenario: Needs-input still distinguishable
- **GIVEN** `fx-status-animation` off
- **WHEN** a session waits on an inline `ask_user` prompt
- **THEN** its card SHALL show a static purple tint, distinct from a running card's static yellow tint

#### Scenario: Selected still distinguishable
- **GIVEN** `fx-selected-glow` off
- **WHEN** the user selects a card
- **THEN** the card SHALL show a static selected border

### Requirement: Reduced motion unaffected

The existing reduced-motion behavior SHALL continue to apply when effects are on; switching an effect off SHALL disable it regardless of the system reduced-motion setting.

#### Scenario: Effects on, reduced motion requested
- **GIVEN** `fx-status-animation` on and the system requests reduced motion
- **WHEN** a session streams
- **THEN** the card SHALL behave as it did before this change under reduced motion
