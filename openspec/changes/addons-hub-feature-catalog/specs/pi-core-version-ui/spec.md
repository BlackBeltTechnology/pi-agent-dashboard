## MODIFIED Requirements

### Requirement: Settings panel version section
The Settings panel SHALL include a unified section, headed **Add-ons**, whose Installed tab renders one row per catalog feature (see `addons-feature-catalog`). By default rows SHALL be grouped as **Core**, **Agent + dashboard features**, **Dashboard-only features** and **Agent-only features**; each feature SHALL appear in exactly one group. Rows flagged `dashboardManaged` SHALL never render as rows of their own; they appear only as the bridge part of their feature.

A feature's pi package part installed from a local/git source has a **resolvable published variant** when the server exposes `publishedVariantSource` (the canonical `npm:<name>` or git spec) for it — resolved via `RECOMMENDED_EXTENSIONS` for recommended packages, or an npm-registry lookup by `package.json name` otherwise. Such a row SHALL render ONE source line in its details (the installed `local`/`git` path) and a `local` badge whose accessible description names the published target and its available version (`publishedVariantVersion`). The row's `⋮` menu SHALL include a **Reset to published version** item. The row SHALL NOT render a second source line or an inline "Reset to npm" link.

The reset action SHALL be gated behind a confirmation dialog whose copy states that the local checkout *link* (not the on-disk files) is discarded and the published version installed, naming the exact published target. When `publishedVariantSource` is absent the row SHALL render a single source line, no `local`-override description and NO reset action.

The reset action SHALL NOT alter the existing Update, Uninstall, or Move affordances on any row, and plain npm-installed rows SHALL be unchanged.

#### Scenario: Dual source lines + reset on a row with a published variant
- **WHEN** a feature's local/git package has a `publishedVariantSource`
- **THEN** the row details SHALL show the installed path as the only source line
- **AND** the row SHALL render a `local` badge whose description names the published target and its available version
- **AND** SHALL offer a "Reset to published version" `⋮`-menu item

#### Scenario: Non-recommended local row resolved by npm-name lookup
- **WHEN** a non-recommended local package's `package.json name` resolves to a published npm package (surfaced as `publishedVariantSource`)
- **THEN** the row SHALL surface the `local` badge description and the menu reset action, identically to a recommended override

#### Scenario: No reset without a resolvable published variant
- **WHEN** a local/git package has no `publishedVariantSource` on the wire
- **THEN** the row SHALL render a single source line and SHALL NOT render a reset action

#### Scenario: Plain npm rows unchanged
- **WHEN** a feature's package is installed from an `npm:` source
- **THEN** it SHALL render a single source line with no `local` badge and no reset action

#### Scenario: Confirmation required before reset
- **WHEN** the user selects the "Reset to published version" menu item
- **THEN** a confirmation dialog SHALL appear naming the discarded local/git link and the exact published target
- **AND** the reset SHALL run only after explicit confirmation

#### Scenario: Default grouping by kind
- **WHEN** the Installed tab renders with default grouping
- **THEN** rows SHALL appear under Core, Agent + dashboard features, Dashboard-only features and Agent-only features, each feature once
