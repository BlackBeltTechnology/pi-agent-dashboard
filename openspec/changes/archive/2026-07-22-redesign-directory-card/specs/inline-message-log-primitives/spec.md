## ADDED Requirements

### Requirement: Shared InlineMessage primitive

The client SHALL provide a single `InlineMessage` component that renders a severity-styled inline surface with: a leading severity accent bar, an icon, a title, optional sub/body content, an optional row of action pills, and an optional `mdiClose` dismiss control. Its colors (background, border, foreground) SHALL be derived exclusively from `--severity-{error,warning,info}-*` theme tokens — no raw Tailwind color literals. It SHALL support a `compact` one-line variant and an `animate` mode that renders a thin top accent-bar sweep to convey an in-flight state. The dismiss control SHALL invoke `onDismiss` only and SHALL NOT perform any other side effect (e.g. it never aborts a session).

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
