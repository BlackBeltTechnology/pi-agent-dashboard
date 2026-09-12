## MODIFIED Requirements

### Requirement: Selector SHALL provide a favorites filter and star toggles

The `ModelSelector` SHALL render models grouped by provider only (NO separate
pinned favorites group), a per-row ★ toggle that dispatches `favorite_model` /
`unfavorite_model`, and a **★ Favs** filter that narrows the list to favorites.
The **★ Favs** filter state SHALL persist per-browser in `localStorage` so it
survives reload regardless of whether it is on or off.

Favorites SHALL be available by default: when a caller passes neither the
favorites set nor the toggle handler, the selector SHALL source both from the
surrounding model-config context. When a caller passes either one, the caller
owns both and the context SHALL NOT be consulted. When the resolved pair has no
toggle handler, the selector SHALL render without star toggles and without the
**★ Favs** filter, and SHALL NOT apply a persisted favs-only state to the list.

#### Scenario: Favorited model shows a filled star inline (no separate group)

- **GIVEN** `"anthropic/claude-opus-4-7"` is favorited
- **WHEN** the dropdown opens with provider filter = "All Providers"
- **THEN** that model SHALL appear under its provider group with a filled ★
  toggle
- **AND** there SHALL be no separate **★ Favorites** group

#### Scenario: Favorites filter narrows the list

- **GIVEN** three favorited models across two providers
- **WHEN** the user enables the **★ Favs** toggle
- **THEN** only those three models SHALL be listed, grouped by provider

#### Scenario: Favs filter persists across reload

- **GIVEN** the user enabled the **★ Favs** toggle
- **WHEN** the page reloads
- **THEN** the selector SHALL restore the **★ Favs** toggle to enabled from
  `localStorage`

#### Scenario: Provider filter still applies within favorites

- **GIVEN** favorites across `anthropic` and `proxy`, **★ Favs** enabled
- **WHEN** the provider filter is set to `anthropic`
- **THEN** only the `anthropic` favorites SHALL be listed

#### Scenario: Settings pickers show favorites without explicit wiring

- **GIVEN** `"anthropic/claude-opus-4-7"` is favorited
- **WHEN** the Sessions → Default Model picker, the Model Proxy add-model
  picker, or the Model Proxy alias-target picker opens and lists that model
- **THEN** that model SHALL show a filled ★ toggle
- **AND** the **★ Favs** filter SHALL be present

#### Scenario: Star toggle from a Settings picker persists globally

- **WHEN** the user toggles ★ on a model from the Sessions → Default Model
  picker
- **THEN** the favorite SHALL be persisted server-side and reflected in the
  composer's selector

#### Scenario: Explicit favorites override the context

- **GIVEN** the context favorites contain model A
- **WHEN** a caller renders the selector with an explicit favorites set
  containing only model B and an explicit toggle handler
- **THEN** only model B SHALL show a filled ★
- **AND** toggling ★ SHALL call the explicit handler, not the context's

#### Scenario: Partial explicit favorites never mix with the context

- **GIVEN** the context has a toggle handler
- **WHEN** a caller renders the selector with an explicit favorites set but no
  toggle handler
- **THEN** the selector SHALL render without ★ toggles and without the
  **★ Favs** filter, and SHALL NOT dispatch to the context handler

#### Scenario: No favorites source degrades to no stars

- **WHEN** the selector renders outside any model-config context and without
  an explicit favorite toggle handler
- **THEN** no ★ toggles and no **★ Favs** filter SHALL render

#### Scenario: Persisted favs-only state does not empty a favorites-less list

- **GIVEN** `localStorage` holds the **★ Favs** filter as enabled
- **WHEN** the selector renders without any favorites source
- **THEN** the full model list SHALL be shown
