# inline-message-log-primitives Specification (delta)

## ADDED Requirements

### Requirement: InlineMessage severity union includes success

The shared `InlineMessage` primitive's `Severity` union SHALL be
`"error" | "warning" | "info" | "success"`. The `success` member SHALL resolve
its background, border, foreground and accent bar from the
`--severity-success-*` tokens, which already ship in the theme layer and
currently have no consumer.

Adding the member SHALL NOT change the rendering of the three existing members,
and SHALL NOT introduce a raw colour literal — `success` follows the same
static class-map pattern as its siblings, because Tailwind cannot JIT-scan a
dynamic `--severity-${severity}-*`.

#### Scenario: Success renders from the success tokens
- **WHEN** `InlineMessage` is rendered with `severity="success"`
- **THEN** its background, border, foreground and accent bar SHALL resolve from `--severity-success-*`
- **AND** SHALL NOT use a raw `green-400`/`green-500` literal

#### Scenario: Existing severities are unchanged
- **WHEN** `InlineMessage` is rendered with `severity="error"`, `"warning"` or `"info"`
- **THEN** its resolved tokens SHALL be identical to those before `success` was added

### Requirement: Notify rows render through the shared severity primitive

A `ctx.ui.notify` row SHALL render via `InlineMessage` rather than a bespoke
bordered box. The level SHALL be conveyed through at least three non-colour
channels — the leading accent bar, a per-level icon, and a visible level word —
so that a user who cannot distinguish the hues can still identify the level
(WCAG 2.2 §1.4.1). This matters beyond aesthetics because `notifyMinLevel` makes
the level the input to a visibility filter.

Migrating the surface SHALL preserve its existing behaviour: the markdown body
still renders, the legacy `params.title` fallback still resolves for rows
reduced from a pre-split `prompt_request`, and an empty message still renders
nothing.

#### Scenario: Level is recoverable without colour
- **WHEN** a notify renders at any level
- **THEN** an icon distinct to that level SHALL render
- **AND** the level name SHALL render as text
- **AND** the level SHALL remain identifiable with colour information removed

#### Scenario: Legacy title-only payload still renders
- **GIVEN** a notify row carrying `params.title` and no `params.message`
- **WHEN** it renders through the primitive
- **THEN** the title SHALL be used as the message body

#### Scenario: Empty message renders nothing
- **GIVEN** a notify row whose message and title are both absent or non-string
- **WHEN** it renders
- **THEN** no row SHALL be produced
