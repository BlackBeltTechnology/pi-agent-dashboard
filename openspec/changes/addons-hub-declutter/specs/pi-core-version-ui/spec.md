## MODIFIED Requirements

### Requirement: Settings panel version section
The Settings panel SHALL include a unified packages section, headed **Add-ons**, that contains three sub-groups: **Core**, **Recommended Extensions**, and **Other Packages**. Each sub-group SHALL render its rows using the same row component, and each package SHALL appear in exactly one sub-group, classified in priority order Core → Recommended → Other. Rows flagged `dashboardManaged` SHALL NOT render in any sub-group. While no installed-list filter is active all three sub-groups SHALL render (an empty one shows its empty hint); while a filter is active a sub-group with no matching row SHALL be hidden.

A local/git-installed row has a **resolvable published variant** when the server exposes `InstalledPackage.publishedVariantSource` (the canonical `npm:<name>` or git spec) for it — resolved via `RECOMMENDED_EXTENSIONS` for recommended rows, or an npm-registry lookup by `package.json name` for non-recommended local rows. Such a row SHALL render ONE source line (the installed `local`/`git` path) and a `local` badge whose accessible description names the published target and its available version (`publishedVariantVersion`). The `⋮` overflow menu SHALL include a **Reset to published version** item whose visible label includes the published version when known and omits it (no empty brackets, no placeholder text) when unknown; the badge description likewise omits an unknown version. The row SHALL NOT render a second source line or an inline "Reset to npm" link. The menu item SHALL stay disabled while the row is `busy` or `locked` (any package operation running), exactly as today.

The reset action SHALL be gated behind a confirmation dialog whose copy states that the local checkout *link* (not the on-disk files) is discarded and the published version installed, naming the exact published target. When `publishedVariantSource` is absent the row SHALL render a single source line, no `local`-override description and NO reset action.

The reset action SHALL NOT alter the existing Update, Uninstall, or Move affordances on any row, and plain npm-installed rows SHALL be unchanged.

#### Scenario: Dual source lines + reset on a row with a published variant
- **WHEN** a local/git row has a `publishedVariantSource`
- **THEN** the row SHALL render the installed path as its only source line
- **AND** SHALL render a `local` badge whose description names the published target and its available version
- **AND** SHALL offer a "Reset to published version" `⋮`-menu item
- **AND** SHALL NOT render an inline "Reset to npm" link

#### Scenario: Non-recommended local row resolved by npm-name lookup
- **WHEN** a non-recommended local row's `package.json name` resolves to a published npm package (surfaced as `publishedVariantSource`)
- **THEN** the row SHALL surface the `local` badge description and the menu reset action, identically to a recommended override

#### Scenario: No reset without a resolvable published variant
- **WHEN** a local/git row has no `publishedVariantSource` on the wire
- **THEN** the row SHALL render a single source line and SHALL NOT render a reset action

#### Scenario: Plain npm rows unchanged
- **WHEN** a row is installed from an `npm:` source
- **THEN** it SHALL render a single source line with no `local` badge and no reset action

#### Scenario: Confirmation required before reset
- **WHEN** the user selects the "Reset to published version" menu item
- **THEN** a confirmation dialog SHALL appear naming the discarded local/git link and the exact published target
- **AND** the reset SHALL run only after explicit confirmation

#### Scenario: Reset disabled while another operation runs
- **WHEN** any package operation is running (`locked`)
- **THEN** the "Reset to published version" menu item SHALL be disabled with the locked reason as its description

#### Scenario: Dashboard-managed rows are excluded
- **WHEN** an installed row carries `dashboardManaged: true`
- **THEN** it SHALL NOT render in Core, Recommended Extensions or Other Packages
