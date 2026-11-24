## MODIFIED Requirements

### Requirement: Page navigation accepts an optional section scroll target
The panel's internal page-navigation helper SHALL accept an optional target identifying a section on the destination page. When supplied, the panel SHALL scroll that section into view after the destination page renders. When omitted, navigation SHALL behave exactly as before, including its existing unsaved-changes gating.

The internal helper's scroll target SHALL be transient and SHALL NOT be encoded in the route. Pages are addressed by `/settings/:page` and the legacy `?tab=<id>` form; in addition, the one-shot `?scroll=` parameter below names a section for navigation arriving from outside the panel.

Navigation from outside the panel MAY name a section with a one-shot `?scroll=<section data-testid>` query parameter on a canonical `/settings/:page` URL (aliased and legacy forms are not required to carry it). The panel SHALL consume it exactly once: after settings have finished loading and the destination page has rendered, it SHALL scroll the element with that `data-testid` into view and then remove the parameter with a history replace, so the URL settles at `/settings/<page>` and no extra history entry is created. A parameter naming no rendered element SHALL be removed without scrolling. If settings never finish loading (for example `/api/config` fails), the parameter MAY remain and no scroll SHALL occur. A value that is not 1–64 characters of `[a-z0-9-]` SHALL be removed without querying the DOM, and no value SHALL cause the panel to fail to render. The parameter SHALL NOT change which page renders. Only the canonical `/settings/<page>?scroll=…` form is honoured; alias, invalid-page and legacy `?tab=` rewrites MAY drop it.

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
- **WHEN** navigation with a scroll target through the internal helper completes
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
