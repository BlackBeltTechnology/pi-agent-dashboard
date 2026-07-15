## MODIFIED Requirements

### Requirement: Settings panel version section
The Settings panel SHALL include a unified packages section that contains three sub-groups: **Core**, **Recommended Extensions**, and **Other Packages**. Each sub-group SHALL render its rows using the same row component, and each package SHALL appear in exactly one sub-group, classified in priority order Core → Recommended → Other.

A local/git-installed row has a **resolvable published variant** when the server exposes `InstalledPackage.publishedVariantSource` (the canonical `npm:<name>` or git spec) for it — resolved via `RECOMMENDED_EXTENSIONS` for recommended rows, or an npm-registry lookup by `package.json name` for non-recommended local rows. Such a row SHALL render TWO source lines: the installed `local`/`git` path AND the published link labeled with its available version (`publishedVariantVersion`). The published line SHALL carry an inline **Reset to npm** affordance, and the `⋮` overflow menu SHALL include a **Reset to published version** item.

The reset action SHALL be gated behind a confirmation dialog whose copy states that the local checkout *link* (not the on-disk files) is discarded and the published version installed, naming the exact published target. When `publishedVariantSource` is absent the row SHALL render a single source line and NO reset action.

The reset action SHALL NOT alter the existing Update, Uninstall, or Move affordances on any row, and plain npm-installed rows SHALL be unchanged.

#### Scenario: Dual source lines + reset on a row with a published variant
- **WHEN** a local/git row has a `publishedVariantSource`
- **THEN** the row SHALL render both the installed path AND the published link with its available version
- **AND** SHALL offer an inline "Reset to npm" and a "Reset to published version" `⋮`-menu item

#### Scenario: Non-recommended local row resolved by npm-name lookup
- **WHEN** a non-recommended local row's `package.json name` resolves to a published npm package (surfaced as `publishedVariantSource`)
- **THEN** the row SHALL surface the second source line + reset action, identically to a recommended override

#### Scenario: No reset without a resolvable published variant
- **WHEN** a local/git row has no `publishedVariantSource` on the wire
- **THEN** the row SHALL render a single source line and SHALL NOT render a reset action

#### Scenario: Plain npm rows unchanged
- **WHEN** a row is installed from an `npm:` source
- **THEN** it SHALL render a single source line with no second published link and no reset action

#### Scenario: Confirmation required before reset
- **WHEN** the user clicks "Reset to npm" or the "Reset to published version" menu item
- **THEN** a confirmation dialog SHALL appear naming the discarded local/git link and the exact published target
- **AND** the reset SHALL run only after explicit confirmation
