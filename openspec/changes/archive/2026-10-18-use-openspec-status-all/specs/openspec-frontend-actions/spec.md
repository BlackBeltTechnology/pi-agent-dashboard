## ADDED Requirements

### Requirement: OpenSpec actions are blocked for a change with a CLI error

When the change a session is attached to carries an `error` in `OpenSpecData`, every OpenSpec action surface SHALL treat that change as blocked. The surfaces are:
- `deriveOpenSpecActions`, which feeds the session card's OpenSpec controls and the composer action strip;
- the mobile action menu (`MobileActionMenu`).

A change with an `error` derives to `PLANNING`, because its `artifacts` are empty. Every `PLANNING` candidate that renders under the current workflow configuration SHALL be blocked: Continue and/or Fast-forward, whether as the primary action or as a `⋯` item.

Each surface SHALL use its existing blocked rendering:
- `aria-disabled` and focusable where the surface already renders blocked actions that way (the primary action, the composer strip);
- native `disabled` where the #745 contract keeps it (the card's `⋯` menu, the mobile rows).

Native-disabled items cannot take focus. The session card's OPENSPEC subcard, on desktop and mobile, SHALL therefore show a focusable error badge whose accessible label carries the capped error message.

`ActionSpec` SHALL gain a literal-reason field for the server-supplied message, since `blockedReasonKey` is i18n-only. When the error and the streaming rule both apply, the error message SHALL be the reason shown.

Explore and Detach are not blocked by this rule; the streaming rule still applies to them. This rule SHALL NOT render any action that would not otherwise render, so "No disabled Archive button SHALL render in any state" continues to hold.

#### Scenario: Attached change is broken

- **GIVEN** a session attached to `add-auth`, both `continue` and `ff` workflows enabled, and `add-auth` carries `error: { code: "change_error", message: "Invalid YAML in metadata file" }`
- **WHEN** the session card, the composer strip and the mobile action menu render
- **THEN** the primary Continue SHALL be blocked on every surface, and the Fast-forward item SHALL be blocked wherever it renders
- **AND** the OPENSPEC subcard SHALL show a focusable error badge whose accessible label contains the message
- **AND** Explore and Detach SHALL not be blocked by this rule
- **AND** no Archive button SHALL render

#### Scenario: Continue workflow disabled

- **GIVEN** the `continue` workflow is disabled, so Fast-forward is the `PLANNING` primary
- **WHEN** the attached change carries an `error`
- **THEN** the Fast-forward primary SHALL be blocked with the message as reason
- **AND** no Continue control SHALL render

#### Scenario: Error clears

- **WHEN** a later `openspec_update` delivers `add-auth` without `error`
- **THEN** the badge SHALL disappear and the actions SHALL return to their normal state-derived behaviour
