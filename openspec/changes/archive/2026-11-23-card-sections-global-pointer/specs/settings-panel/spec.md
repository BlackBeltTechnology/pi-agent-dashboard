## MODIFIED Requirements

### Requirement: Page navigation accepts an optional section scroll target
The panel's internal page-navigation helper SHALL accept an optional target identifying a section on the destination page. When supplied, the panel SHALL scroll that section into view after the destination page renders. When omitted, navigation SHALL behave exactly as before, including its existing unsaved-changes gating.

The internal helper's scroll target SHALL be transient and SHALL NOT be encoded in the route. The only query-encoded section target is the external one-shot `?scroll=` parameter, which is honoured only on a canonical `/settings/:page?/:sub?` URL (see "Canonical and legacy settings URLs").

Navigation from outside the panel MAY name a section with a one-shot `?scroll=<section data-testid>` query parameter on a canonical `/settings/:page?/:sub?` URL (alias, invalid-page and legacy `?tab=` rewrites MAY drop it). The panel SHALL consume it exactly once: after settings have loaded successfully and the destination page has rendered, it SHALL scroll the element with that `data-testid` into view and then remove the parameter with a history replace, so the URL settles at the same path without the parameter (any `:sub` segment is preserved) and no extra history entry is created. A parameter naming no rendered element SHALL be removed without scrolling. If settings never finish loading (for example `/api/config` fails), the parameter MAY remain and no scroll SHALL occur. A value that is not 1–64 characters of `[A-Za-z0-9_-]` SHALL be removed without querying the DOM, and no value SHALL cause the panel to fail to render. The parameter SHALL NOT change which page renders. The parameter SHALL also be honoured when it arrives while the panel is already mounted, including a repeat arrival of the same value after it was consumed.

#### Scenario: Navigate with a scroll target
- **WHEN** navigation is requested to the Developer page with the pi runtime picker as the scroll target
- **THEN** the panel SHALL navigate to `/settings/developer`
- **AND** SHALL scroll the pi runtime picker into view

#### Scenario: Scroll target survives gated (deferred) navigation
- **WHEN** navigation with a scroll target is deferred by the navigation guard and later confirmed
- **THEN** the deferred navigation SHALL still scroll the named section into view after the destination page renders
- **AND** the target SHALL be carried by the panel alongside its pending navigation — not re-derived from the route

#### Scenario: Navigate without a scroll target
- **WHEN** navigation is requested with no scroll target, as the Save Bar page chips do
- **THEN** the panel SHALL navigate to the destination page with no scrolling behaviour change

#### Scenario: Navigation gating is exactly the rail helper's own
- **WHEN** navigation with a scroll target is requested while the panel is showing a dirty plugin page — the only condition under which the rail helper gates
- **THEN** the same guard that applies to Save Bar page-chip navigation SHALL apply, including the confirmation round trip
- **AND** built-in draft state SHALL continue NOT to block page switches, exactly as with the chips (the guard exists for plugin-page edits only)
- **AND** no new or strengthened gate SHALL be introduced for the scroll-target case

#### Scenario: Route stays unchanged
- **WHEN** navigation with a scroll target via the internal helper completes
- **THEN** the resulting URL SHALL be `/settings/<page>` with no fragment or additional query parameter naming the section

#### Scenario: External scroll parameter is consumed after load
- **GIVEN** settings are still loading
- **WHEN** the app navigates to `/settings/general?scroll=card-sections-settings`
- **THEN** after loading completes the `Session card sections` block SHALL be scrolled into view exactly once
- **AND** the URL SHALL then read `/settings/general` via a history replace

#### Scenario: Hostile external scroll value is dropped safely
- **WHEN** the app navigates to `/settings/general?scroll=%22%5D%20x`
- **THEN** the General page SHALL render normally without scrolling
- **AND** the `scroll` parameter SHALL be removed

#### Scenario: Unknown external scroll target is dropped
- **WHEN** the app navigates to `/settings/general?scroll=does-not-exist`
- **THEN** the General page SHALL render without scrolling
- **AND** the `scroll` parameter SHALL be removed

#### Scenario: External scroll parameter while Settings is already open
- **GIVEN** the General page is open with settings loaded
- **WHEN** the app navigates to `/settings/general?scroll=card-sections-settings`
- **THEN** the `Session card sections` block SHALL be scrolled into view
- **AND** the URL SHALL then read `/settings/general`

#### Scenario: Sub-page path is preserved when the parameter is removed
- **WHEN** the app navigates to `/settings/plugins/kb?scroll=some-section`
- **THEN** after consumption the URL SHALL read `/settings/plugins/kb`

### Requirement: Canonical and legacy settings URLs
The settings panel SHALL be addressable at the canonical path `/settings/:page?` and SHALL continue to honor the legacy query form `/settings?tab=<id>` indefinitely. Resolution SHALL run inside the single mounted panel in this order: (1) a valid route `:page`; (2) a valid legacy `?tab=<id>`, which SHALL trigger a history-`replace` navigation to `/settings/<id>`; (3) otherwise default to `/settings/general` via history-`replace`. The alias map `advanced → developer`, `servers → remote` and `packages → add-ons` SHALL be applied before validation so old links resolve to the new page homes; an aliased route `:page` SHALL be replace-navigated to its canonical id. A canonical `/settings/:page?/:sub?` URL MAY additionally carry the one-shot `?scroll=<section data-testid>` parameter, which the panel consumes and removes (see "Page navigation accepts an optional section scroll target"); it SHALL NOT affect page resolution.

#### Scenario: Canonical page URL
- **WHEN** the user opens `/settings/security`
- **THEN** the Security page SHALL render
- **AND** the URL SHALL remain `/settings/security`

#### Scenario: Canonical page URL with a one-shot scroll parameter
- **WHEN** the user opens `/settings/general?scroll=card-sections-settings`
- **THEN** the General page SHALL render
- **AND** after consumption the URL SHALL read `/settings/general`

#### Scenario: Legacy query upgrades to canonical
- **WHEN** the user opens `/settings?tab=security`
- **THEN** the panel SHALL `replace`-navigate to `/settings/security`
- **AND** the Security page SHALL render
- **AND** no extra browser-history entry SHALL be added

#### Scenario: Legacy aliased ids resolve to new homes
- **WHEN** the user opens `/settings?tab=advanced` or `/settings?tab=servers`
- **THEN** the panel SHALL resolve to `/settings/developer` and `/settings/remote` respectively

#### Scenario: Old packages URL resolves to Add-ons
- **WHEN** the user opens `/settings/packages` or `/settings?tab=packages`
- **THEN** the panel SHALL `replace`-navigate to `/settings/add-ons`
- **AND** the Add-ons page SHALL render
- **AND** no extra browser-history entry SHALL be added

#### Scenario: Unknown page falls back to general
- **WHEN** the user opens `/settings/bogus`
- **THEN** the panel SHALL `replace`-navigate to `/settings/general`
