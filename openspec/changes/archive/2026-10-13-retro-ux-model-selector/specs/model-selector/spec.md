## MODIFIED Requirements

### Requirement: Selector SHALL provide a favorites filter and star toggles

The `ModelSelector` SHALL render models grouped by provider only (NO separate
pinned favorites group), a per-row ★ toggle that dispatches `favorite_model` /
`unfavorite_model`, and a **Favorites only** filter that narrows the list to favorites.
The filter (formerly labelled "★ Favs") SHALL have the visible label "Favorites only" (translated) and expose its state with
`aria-pressed`, the pressed state painted with the `--tint-blue-*` family. Each ★ toggle SHALL be at least 44×44 px below the `sm` breakpoint and 32×32 px from `sm` up (`ui-contract.md` tap-target), carry the translated accessible name "Favorite <model>", expose its state with
`aria-pressed`, and show the state by shape (filled vs outline) in `--text-primary` /
`--text-secondary` — no Tailwind palette class.
The **Favorites only** filter state SHALL persist per-browser in `localStorage` so it
survives reload regardless of whether it is on or off.

Favorites SHALL be available by default: when a caller passes neither the
favorites set nor the toggle handler, the selector SHALL source both from the
surrounding model-config context. When a caller passes either one, the caller
owns both and the context SHALL NOT be consulted. When the resolved pair has no
toggle handler, the selector SHALL render without star toggles and without the
**Favorites only** filter, and SHALL NOT apply a persisted favs-only state to the list.

#### Scenario: Favorited model shows a filled star inline (no separate group)

- **GIVEN** `"anthropic/claude-opus-4-7"` is favorited
- **WHEN** the dropdown opens with provider filter = "All Providers"
- **THEN** that model SHALL appear under its provider group with a filled ★
  toggle
- **AND** there SHALL be no separate **★ Favorites** group

#### Scenario: Favorites filter narrows the list

- **GIVEN** three favorited models across two providers
- **WHEN** the user enables the **Favorites only** toggle
- **THEN** only those three models SHALL be listed, grouped by provider

#### Scenario: Favs filter persists across reload

- **GIVEN** the user enabled the **Favorites only** toggle
- **WHEN** the page reloads
- **THEN** the selector SHALL restore the **Favorites only** toggle to enabled from
  `localStorage`

#### Scenario: Provider filter still applies within favorites

- **GIVEN** favorites across `anthropic` and `proxy`, **Favorites only** enabled
- **WHEN** the provider filter is set to `anthropic`
- **THEN** only the `anthropic` favorites SHALL be listed

#### Scenario: Settings pickers show favorites without explicit wiring

- **GIVEN** `"anthropic/claude-opus-4-7"` is favorited
- **WHEN** the Sessions → Default Model picker, the Model Proxy add-model
  picker, or the Model Proxy alias-target picker opens and lists that model
- **THEN** that model SHALL show a filled ★ toggle
- **AND** the **Favorites only** filter SHALL be present

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
  **Favorites only** filter, and SHALL NOT dispatch to the context handler

#### Scenario: No favorites source degrades to no stars

- **WHEN** the selector renders outside any model-config context and without
  an explicit favorite toggle handler
- **THEN** no ★ toggles and no **Favorites only** filter SHALL render

#### Scenario: Persisted favs-only state does not empty a favorites-less list

- **GIVEN** `localStorage` holds the **Favorites only** filter as enabled
- **WHEN** the selector renders without any favorites source
- **THEN** the full model list SHALL be shown

#### Scenario: Star and filter are named and token-painted
- **WHEN** the dropdown opens with favorites enabled
- **THEN** the filter button reads "Favorites only" with `aria-pressed`, each ★ toggle is at least 32×32 px at 1440 px (44×44 px at 375 px) with the accessible name "Favorite <model>", and no element in the filter row or the ★ toggles carries a `text-amber-*` or `border-amber-*` class

### Requirement: Selector SHALL render capability badges with confidence

The `ModelSelector` SHALL render a `🧠` badge for `reasoning: true` and a `👁`
badge for `vision: true` ONLY when `metadataSource === "catalog"`. When `metadataSource === "fallback"` it SHALL render the `🧠` and `👁` icons followed by the translated word "assumed" in `--text-secondary` (11 px or larger), not a 9 px `?` overlay; each badge SHALL carry visually hidden text naming the capability and its confidence.
When `metadataSource` is absent it SHALL render no capability badge.

#### Scenario: Confirmed capability shows solid badge

- **GIVEN** a model with `metadataSource: "catalog"`, `reasoning: true`, `vision: true`
- **THEN** the row SHALL show a solid `🧠` and a solid `👁`

#### Scenario: Confirmed-absent capability shows no badge

- **GIVEN** a model with `metadataSource: "catalog"`, `vision: false`
- **THEN** the row SHALL NOT show any vision marker

#### Scenario: Assumed capability shows question marker

- **GIVEN** a model with `metadataSource: "fallback"`
- **THEN** the row SHALL show the `👁` and `🧠` icons followed by the word "assumed" (not solid badges and not a `?` overlay)

### Requirement: Model dropdown surfaces provider refresh failures

When the `models_list` for the selected session reports that one or more providers failed to refresh **and the resulting list is non-empty**, the model selector dropdown SHALL render a single non-blocking footer stating a count of unavailable providers (e.g. "1 provider unavailable") as a warning-severity pill, together with a ghost button "Open providers" (`data-testid="model-provider-settings-link"` kept; it shares the id with the empty-state button as built, and the two never render together because the footer needs a non-empty list) that opens Settings → Providers (it navigates inside the app, so it is a button, not a link). The footer SHALL NOT name individual providers and SHALL NOT restate the per-provider messages; per-provider names and verbatim error text live in Settings → Providers (see `surface-provider-health-in-settings`). The notice SHALL NOT prevent selecting any model in the list.

When no provider failure is reported, the footer SHALL render no notice — a clean refresh SHALL be silent.

The notice SHALL NOT be presented as a toast or other transient global alert, because the refresh fires on every dropdown open and a persistently failing provider would otherwise alert repeatedly.

Design mockup: `mockups/empty-model-selector.html` state 4 ("partial failure"); decision D1-B.

#### Scenario: One provider fails to refresh

- **WHEN** the dropdown is open, the list is non-empty, and the session's `models_list` reports a refresh failure for a provider
- **THEN** the footer SHALL show a count of unavailable providers in a warning pill and an "Open providers" button
- **AND** the footer SHALL NOT name the provider
- **AND** the models already in the list SHALL remain selectable

#### Scenario: Several providers fail to refresh

- **WHEN** the session's `models_list` reports refresh failures for more than one provider and the list is non-empty
- **THEN** the footer SHALL show the total count of unavailable providers (not individual names)

#### Scenario: Clean refresh is silent

- **WHEN** the session's `models_list` reports no refresh failure
- **THEN** the footer SHALL render no refresh notice

#### Scenario: Failure is not raised as a toast

- **WHEN** a refresh failure is reported
- **THEN** no toast or global alert SHALL be raised for it

### Requirement: Recovery link when genuinely empty

After an open-triggered refresh has completed and the list is still empty, the empty-state body SHALL render the headline "No models available", a help line explaining that connecting a provider adds models and that closing and reopening the list refreshes it, and a secondary button labelled `Open provider settings` with a settings (gear) icon and no directional arrow (`data-testid="model-provider-settings-link"` kept). Activating it SHALL navigate to the dashboard's Settings → Providers surface.

The link SHALL NOT be rendered while the selector is still awaiting the first `models_list` after opening (the `awaitingRefresh` window). The window ENDS — and the empty state is treated as settled — on the FIRST of: (a) a `models_list` for the selected session arriving since the open-triggered `request_models`, or (b) the open-triggered refresh's safety timeout elapsing without any such `models_list`. When the window ends with the list still empty (either path), the recovery link SHALL be shown; a refresh that never returns therefore falls back to the link rather than stranding the operator on the refreshing body. This still prevents a premature "no models" affordance during a normal in-flight refresh.

Design mockup: `mockups/empty-model-selector.html` state 2 ("genuinely empty"); decision D4-A in `mockups/selector-decisions.html`.

#### Scenario: Link appears only after a post-open empty result

- **WHEN** the selector was opened (open-triggered `request_models` sent) and no `models_list` has yet arrived
- **THEN** the empty state SHALL show the refreshing body and SHALL NOT show the recovery link
- **WHEN** a `models_list` for the session then arrives with an empty `models` array
- **THEN** the empty state SHALL show the `Open provider settings` link

#### Scenario: Safety timeout with no response reveals the link

- **WHEN** the selector was opened (open-triggered `request_models` sent) and no `models_list` arrives before the safety timeout elapses
- **THEN** the `awaitingRefresh` window SHALL end
- **AND** with the list still empty the empty state SHALL show the `Open provider settings` link

#### Scenario: Link navigates to provider settings

- **WHEN** the user activates the `Open provider settings` link
- **THEN** the dashboard SHALL open the Settings → Providers surface

### Requirement: Empty-and-errored state uses reopen-to-retry

When the post-refresh empty state coincides with one or more `refreshErrors`, the empty state SHALL present the same `Open provider settings` recovery button (gear icon, no arrow) and help line as "Recovery link when genuinely empty" and SHALL NOT render an inline "Retry" control. Retrying a refresh is performed by closing and reopening the selector, keeping the open transition the single refresh trigger (consistent with the removal of the manual ↻ control).

Design mockup: `mockups/empty-model-selector.html` state 3; decision D5-B.

#### Scenario: Empty + error shows no inline Retry

- **WHEN** a post-open `models_list` arrives empty and carries `refreshErrors`
- **THEN** the empty state SHALL show the `Open provider settings` button
- **AND** SHALL NOT render an inline Retry control
- **WHEN** the user closes and reopens the selector
- **THEN** a new open-triggered `request_models` SHALL be sent

### Requirement: The model-selector primitive SHALL offer an opt-in Role tab

`ui:model-selector` SHALL accept an opt-in `allowRoles` prop. When `allowRoles` is set AND the roles plugin is installed, the picker SHALL present a "Models" | "Roles" tab switch following the WAI-ARIA tabs pattern: a `role="tablist"` with two `role="tab"` buttons carrying `aria-selected`, `aria-controls` and roving `tabindex`, ArrowLeft/ArrowRight moving selection and focus between them, each controlling a `role="tabpanel"`; each tab SHALL be at least 44 px tall below the `sm` breakpoint and 32 px from `sm` up. The Roles tab SHALL list every effective role (built-in and custom) through the shared role-ref display (see "Role refs render through one shared display"): its current resolution (model and thinking level), or a warning pill "No model assigned" carrying `data-testid="role-unassigned"`; the current role SHALL be marked with a check icon and `aria-current="true"`. Selecting a role SHALL invoke `onSelect` with `@<role>`. When `current` is a role ref, the picker SHALL open on the Roles tab and the trigger SHALL show the role and its current resolution through the shared role-ref display. When `allowRoles` is absent, or the roles plugin is not installed, the picker SHALL render and behave exactly as before this change.

#### Scenario: Role tab hidden without opt-in
- **WHEN** a caller renders the primitive without `allowRoles`
- **THEN** no Role tab SHALL be rendered

#### Scenario: Role tab hidden without roles plugin
- **WHEN** a caller sets `allowRoles` but the roles plugin is not installed
- **THEN** no Role tab SHALL be rendered and the picker SHALL behave as the plain model picker

#### Scenario: Selecting a role emits a role ref
- **WHEN** the user picks role `fast` on the Role tab
- **THEN** `onSelect` SHALL be called with `@fast`

#### Scenario: Custom roles are listed
- **GIVEN** a custom role `doubt-verifier` exists
- **WHEN** the Role tab opens
- **THEN** `doubt-verifier` SHALL be listed alongside the built-in roles

#### Scenario: Trigger shows resolution of a bound role
- **GIVEN** `current` is `@fast` and `fast` resolves to `anthropic/claude-haiku-4-5`
- **THEN** the trigger SHALL show `@fast` together with `anthropic/claude-haiku-4-5`

#### Scenario: Unassigned role is selectable but flagged
- **WHEN** the Role tab lists a role with no assignment
- **THEN** the row SHALL show the warning pill "No model assigned" (`data-testid="role-unassigned"`)

### Requirement: Session model pickers SHALL resolve a role once

The StatusBar / composer model picker and the openspec run-dialog model picker SHALL enable the Role tab. Picking a role there SHALL resolve it from fresh role data at pick time (not a cached list) and change the session model to the resolved concrete model, and the thinking level to the resolved level when present AND supported by that model (an unsupported level SHALL be skipped with a notice, leaving the model change in place). The session SHALL NOT follow later changes to that role or preset. After such a pick the trigger SHALL indicate the role it was resolved from, as the translated text "from @<role>" at 12 px in `--text-secondary` after the model (`data-testid="model-via-role"` kept), until the session model changes again. Pick notices (unassigned, level skipped, roles unavailable) SHALL render as a warning-severity callout with an icon and `role="status"`, keeping `data-testid="role-pick-notice"` / `run-config-role-notice` and `data-kind`.

#### Scenario: Pick a role in the status bar
- **GIVEN** `coding` resolves to `anthropic/claude-sonnet-4-5:high`
- **WHEN** the user picks `@coding` in the status-bar picker
- **THEN** the session model SHALL change to `anthropic/claude-sonnet-4-5` and the session thinking level SHALL change to `high`
- **AND** the trigger SHALL indicate "from @coding"

#### Scenario: Later preset change does not move the session
- **WHEN** after that pick the active preset reassigns `coding` to another model
- **THEN** the running session's model SHALL remain `anthropic/claude-sonnet-4-5`

#### Scenario: Unsupported resolved level is skipped
- **GIVEN** `fast` resolves to a model that does not support level `high` and the ref carries `high`
- **WHEN** the user picks `@fast` in a session picker
- **THEN** the session model SHALL change AND the thinking level SHALL NOT be set to `high` AND a warning callout SHALL say the model was set from the role and the level was left unchanged

#### Scenario: Unassigned role cannot change the session model
- **WHEN** the user picks a role that is unassigned in a session picker
- **THEN** the session model SHALL NOT change and the picker SHALL show that the role is unassigned

## ADDED Requirements

### Requirement: Role refs render through one shared display
`@blackbelt-technology/dashboard-plugin-runtime` SHALL export a presentational `RoleRef` component that renders an `@role[:level]` reference as: the role token (`@role`, monospace, bordered, `--text-primary`), the resolved model's id (`--text-primary`, monospace, truncating), and the thinking level as a chip (12 px, `--text-secondary`, with visually hidden "thinking" text). The model SHALL render as `<span class="sr-only">provider/</span>id` inside the same element, with no `aria-label` override, so `textContent` and the accessible name contain `provider/id` while the visible text stays short. When a model value is present it SHALL be shown (for a `dangling` binding that is the last model kept, alongside the status pill from `role-model-bindings`); only when no model value exists SHALL the warning pill "No model assigned" render. `RoleRef` SHALL take its visible strings ("No model assigned", "from", "thinking") through a `labels` prop with English defaults, so each host passes its own translated strings. Every surface that shows a role ref SHALL use `RoleRef`: the `ModelSelector` trigger (so every host that mounts it: composer, OpenSpec run-config, grammar, automation dialog, Blackhole base and chain pickers) and its Roles tab, the roles settings pills and the role in each "Used by" row, and the Blackhole chain-slot summary; hosts SHALL NOT render role refs with their own markup. `RoleRef` SHALL take strings in and SHALL NOT fetch.

#### Scenario: Same ref, same display in two hosts
- **WHEN** the Roles tab row for `@fast` and the roles settings pill for `fast` both show `fast` resolved to `anthropic/claude-haiku-4-5` at level `low`
- **THEN** both render the role token "@fast", the visible model "claude-haiku-4-5", a level chip "low", and text content containing "anthropic/claude-haiku-4-5" (the provider prefix in a `sr-only` span, no `aria-label` on the element)

#### Scenario: Unresolved role is stated in text
- **WHEN** `RoleRef` renders `@research` with no resolution
- **THEN** it shows "@research" and a warning-severity pill "No model assigned"

#### Scenario: Trigger keeps the full ref readable
- **GIVEN** `current` is `@fast` resolving to `anthropic/claude-haiku-4-5` at `low`
- **THEN** the trigger's visible text is "@fast", "claude-haiku-4-5" and "low", and its text content contains "anthropic/claude-haiku-4-5"

### Requirement: Model list is a keyboard-operable grid
The Models tab SHALL follow the WAI-ARIA combobox-with-grid-popup pattern: the filter input SHALL have `role="combobox"`, `aria-haspopup="grid"`, `aria-expanded="true"` while the list is shown, `aria-controls` the list and `aria-activedescendant` the active row (or the active cell); the list SHALL have `role="grid"` with one `role="row"` per model (`data-testid="model-row"` kept), each holding gridcells for the model, its capabilities and its ★ toggle; each provider group SHALL be a `role="rowgroup"` with `aria-labelledby` pointing at its header's `id`. ArrowUp/ArrowDown SHALL move the active row (the first row is active after each filter change, so typing then Enter still picks the first match), Enter SHALL select it, Escape SHALL close. ArrowRight SHALL move the active descendant from the model cell to the row's ★ cell only when the caret is at the end of the filter text; otherwise ArrowLeft/ArrowRight move the caret as in any text input. While the ★ cell is active, Enter or Space SHALL toggle the favourite and ArrowLeft SHALL return to the model cell. The current model SHALL be marked by a check icon and `aria-selected="true"`, not by accent-coloured text. The trigger SHALL use `aria-haspopup="dialog"`; the panel SHALL be `role="dialog"` with `aria-modal="false"` and the translated `aria-label` "Choose a model". This picker is a non-modal popover on the `popover` layer, not a `Dialog` primitive: outside click closes it, the page stays interactive, and it has no focus trap. It is the documented exception to `ui-contract.md` accessibility invariant 5 (modal dialogs), recorded by task 3.12; Escape still closes it and returns focus to the trigger.

#### Scenario: Keyboard-only model choice
- **WHEN** focus is in the filter and the user presses ArrowDown twice then Enter
- **THEN** `aria-activedescendant` moved to the second row then the third, and `onSelect` is called with that row's `provider/id`

#### Scenario: Star reachable by keyboard
- **GIVEN** the filter is empty (caret at the end) and the second row is active
- **WHEN** the user presses ArrowRight, then Enter
- **THEN** `aria-activedescendant` points at that row's ★ cell and the favourite toggle for that model is invoked

#### Scenario: Arrow keys still edit the filter text
- **GIVEN** the filter holds "sonnet" with the caret after "son"
- **WHEN** the user presses ArrowRight
- **THEN** the caret moves one character and `aria-activedescendant` still points at the active row

#### Scenario: Popover is non-modal and closes on Escape
- **WHEN** the dropdown is open and the user presses Escape
- **THEN** the panel (`role="dialog"`, `aria-modal="false"`) closes and focus returns to the trigger

#### Scenario: Current model is not shown by colour alone
- **WHEN** the dropdown lists the current model
- **THEN** its row has `aria-selected="true"` and a check icon, and no `--accent-blue` text class

### Requirement: Model selector conforms to the UI contract in every state
The trigger, dropdown and Roles tab SHALL contain no Tailwind palette class, hex or `rgba(` literal and no `--text-muted` information text, and SHALL pass the contrast, size and focus probes in `{base,dark}`, `{base,light}` and `{nord,dark}` in these states: Models tab, favourites only, filter with no match, refreshing, empty, provider refresh errors, Roles tab, no roles. The trigger SHALL be at least 44 px tall below the `sm` breakpoint and 32 px from `sm` up. Provider group headers SHALL be 12 px semibold `--text-secondary` (section-heading recipe); the `provider/id` sublabel and the context chip SHALL be 11 px `--text-secondary`; a capability reported only by fallback SHALL show the word "assumed" instead of a 9 px "?" and keep the badge `title` text (e.g. "Vision assumed — …"); the refreshing state SHALL be a `role="status"` line with a spinner; the "No roles" state SHALL say how to define roles.

#### Scenario: Probes pass in every state
- **WHEN** each listed state is rendered in each default theme at 375, 768 and 1440 px viewports (the L3 capture spec; the mockup board was measured at 1440 px only)
- **THEN** `contrastFailures`, `sizeFailures` (11 px floor, 12 px inside button/label/a) and `buttonsWithoutFocusIndicator` from `tests/e2e/helpers/computed-contrast.ts` report no failures

#### Scenario: Existing test ids survive
- **WHEN** the dropdown renders in any state
- **THEN** every protected `data-testid` listed in `mockups/ui-plan.md` § Protected is still present where it was
