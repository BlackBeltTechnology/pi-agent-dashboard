# inline-message-log-primitives Specification

## Purpose
TBD - created by archiving change redesign-directory-card. Update Purpose after archive.
## Requirements
### Requirement: Shared InlineMessage primitive

The client SHALL provide a single `InlineMessage` component that renders a severity-styled inline surface with: a leading severity accent bar, an icon, a title, optional sub/body content, an optional row of action pills, and an optional `mdiClose` dismiss control. Its colors (background, border, foreground) SHALL be derived exclusively from the `--severity-*` theme token family (`error`, `warning`, `info`, `success`) — no raw Tailwind color literals. It SHALL support a `compact` one-line variant and an `animate` mode that renders a thin top accent-bar sweep to convey an in-flight state. The dismiss control SHALL invoke `onDismiss` only and SHALL NOT perform any other side effect (e.g. it never aborts a session).

#### Scenario: Severity drives tokens
- **WHEN** `InlineMessage` is rendered with `severity="warning"`
- **THEN** its background, border, and foreground SHALL resolve from `--severity-warning-*` tokens and SHALL NOT use raw `amber-500`/`red-500` literals

#### Scenario: Compact variant is one line
- **WHEN** `InlineMessage` is rendered with `variant="compact"` and a single title plus one action
- **THEN** it SHALL render the icon, title, and action on one line without a separate body block

#### Scenario: Dismiss is side-effect-free
- **WHEN** the user activates the dismiss control on an `InlineMessage`
- **THEN** only the supplied `onDismiss` callback SHALL fire (no abort or navigation)

### Requirement: Shared LogBlock primitive

The client SHALL provide a single `LogBlock` component that renders a monospace inset panel with a labelled header, a copy control, and (when `collapsible`) a collapse/expand toggle; the body SHALL wrap or scroll within a bounded `maxHeight`. It SHALL support a `preview` mode that shows the last N lines with copy + expand affordances. The copy control SHALL place the full log text on the clipboard regardless of the collapsed/preview view.

#### Scenario: Copy yields full text even when collapsed
- **WHEN** a `LogBlock` is rendered collapsed (or in `preview` mode showing only the last 3 lines) and the user activates copy
- **THEN** the FULL log text SHALL be written to the clipboard, not only the visible lines

#### Scenario: Collapsible toggle expands the body
- **WHEN** a collapsible `LogBlock` is closed and the user activates the expand toggle
- **THEN** the full log body SHALL become visible, bounded by `maxHeight` with scroll

### Requirement: Inline error/log surfaces consume the shared primitives

The `SpawnErrorBanner`, `SessionBanner`, and `MissingToolInlineError` surfaces SHALL render via the shared `InlineMessage` primitive, and every monospace log/stderr display SHALL render via the shared `LogBlock` primitive. The near-duplicate `TimeoutBanner` SHALL be expressed as `InlineMessage severity="warning"` rather than a separate component. Each migrated surface SHALL preserve its observable controls, copy strings, i18n keys, and `data-testid`s.

#### Scenario: Timeout banner is a warning InlineMessage
- **WHEN** a spawn fails with a register-timeout
- **THEN** the surface SHALL render as an `InlineMessage` with `severity="warning"` (no separate `TimeoutBanner` component)
- **AND** the `spawn-timeout-banner` test id SHALL still resolve to the rendered surface

#### Scenario: Spawn stderr renders in a LogBlock
- **WHEN** a spawn error carries `stderr`
- **THEN** the stderr SHALL render inside a collapsible `LogBlock` (closed by default) with a copy control, not an ad-hoc `<details><pre>` block

### Requirement: InlineMessage severity union includes success

The shared `InlineMessage` primitive's `Severity` union SHALL be
`"error" | "warning" | "info" | "success"`. The `success` member SHALL resolve
its background, border, foreground and accent bar from the existing
`--severity-success-*` tokens — the same triple already consumed by `Toast.tsx`
and `extension-ui/ToastSlot.tsx`. Those consumers SHALL be unaffected.

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

