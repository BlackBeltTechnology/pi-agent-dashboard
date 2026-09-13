## MODIFIED Requirements

### Requirement: Client SHALL render a per-provider quota widget and degrade gracefully
The client entry SHALL claim the `composer-context-group` slot and render a `Quota` context group holding one chip per provider present in `/api/quota` `providers[]` with at least one window, and SHALL claim `settings-section` for the ToS gate + master enable + per-provider toggles. Each chip SHALL show the provider name followed by **every** window inline as `<window label> <pace bar> <used %>`, with the bar fill coloured by pace severity and a `now` tick. When the provider is flagged `stale` by the server the chip SHALL render its bars muted and append a dashed `not live` tag. When no provider has windows the client SHALL render nothing — no chip, no group, no note, no error. The label, note and chip accessible names SHALL be localized like the plugin's other strings.

When `providers[]` is non-empty, the session's model provider is the prefix of `session.model` before the first `/` (undefined when `session.model` is undefined or has no `/`). The chip matching that provider SHALL render first with an accent ring and full opacity; other chips SHALL follow at reduced opacity. The chip SHALL NOT repeat the model id. When the provider is defined but absent from `providers[]`, a non-interactive dashed note `<model id> · no quota` (model id = the part after the first `/`) SHALL precede the chips, all of which SHALL render un-ringed at reduced opacity. When the provider is undefined, no chip SHALL be ringed or dimmed and no note SHALL render. Emphasis SHALL be derived on every render from the session, so a model change re-orders the chips without user action.

#### Scenario: Widget renders from /api/quota
- **WHEN** `/api/quota` returns a provider with windows
- **THEN** the client SHALL render that provider's chip in the `Quota` context group with one labelled pace bar per window, each fill coloured by pace severity

#### Scenario: No data shows no widget
- **WHEN** `/api/quota` returns no providers (disabled or none enabled)
- **THEN** the client SHALL render no quota chip, no `Quota` group and no error

#### Scenario: Session provider chip leads with ring
- **WHEN** `session.model` is `anthropic/claude-x` and `/api/quota` returns `anthropic` and `openai-codex`
- **THEN** the `anthropic` chip SHALL render first with the accent ring, followed by the dimmed `openai-codex` chip

#### Scenario: Session provider without quota shows a note
- **WHEN** `session.model` is `google-vertex/gemini-x` and `/api/quota` returns only `anthropic`
- **THEN** a dashed non-interactive note `gemini-x · no quota` SHALL precede the un-ringed, dimmed `anthropic` chip

#### Scenario: Model switch moves the ring
- **WHEN** the session's model changes from `anthropic/…` to `openai-codex/…`
- **THEN** the `openai-codex` chip SHALL become first and ringed on the next render, with no user interaction

#### Scenario: Model without provider prefix gets no emphasis
- **WHEN** `session.model` is `my-alias` (no `/`) and `/api/quota` returns `anthropic`
- **THEN** the `anthropic` chip SHALL render un-ringed and no note SHALL render

#### Scenario: Stale provider is tagged
- **WHEN** `/api/quota` returns a provider with `stale: true`
- **THEN** the chip SHALL render its bars muted and append a `not live` tag

### Requirement: Clicking a slider SHALL open the shared Dialog primitive with a provider selector
Clicking a provider chip SHALL open the dashboard's shared `Dialog` primitive
(`useUiPrimitive(UI_PRIMITIVE_KEYS.dialog)`), pre-selected to that provider, with a
selector to switch provider or show all. The plugin SHALL NOT hand-roll a modal. The
`no quota` note SHALL NOT be clickable.

#### Scenario: Click opens dialog pre-selected to the provider
- **WHEN** the user clicks the Codex chip
- **THEN** the shared `Dialog` SHALL open centered and modal, showing the Codex
  card (its windows with pace bars, `now` tick, projected %)

#### Scenario: Selector switches to all providers
- **WHEN** the user selects `All`
- **THEN** the dialog SHALL render a card for every provider in `/api/quota`

#### Scenario: Dialog inherits primitive behaviour
- **WHEN** the dialog is open
- **THEN** Esc and click-outside SHALL close it and it SHALL expose `role="dialog"`
  with `aria-modal`
