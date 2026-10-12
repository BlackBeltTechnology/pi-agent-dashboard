## MODIFIED Requirements

### Requirement: PackageBrowser SHALL render an Installed Packages section by default

The `PackageBrowser` component SHALL render a dedicated "Installed Packages" section above the search results when its `showInstalledSection` prop is `true` (the default). The section SHALL list every row returned by `useInstalledPackages(scope, cwd)` whose `isRecommended === false` (recommended ones already render in the existing `RecommendedExtensions` panel) and that is not flagged `dashboardManaged` (dashboard-owned plugin bridges are never listed). Each row SHALL be a `PackageRow` and SHALL display source-type badges via `classifySource(pkg.source)`. The section SHALL render the same way regardless of source shape — `npm:`, absolute path, relative path, `file://`, `git://`, `https://...git`, and bare git URLs all SHALL produce a row with `Update` and `Uninstall` actions.

When `showInstalledSection` is `false`, the component SHALL NOT render the Installed Packages section. This case applies in Settings → Add-ons, where `UnifiedPackagesSection` (Add-ons) is the canonical global-scope manage surface and rendering both would duplicate every installed row.

#### Scenario: npm-source row in workspace scope

- **WHEN** the workspace `<cwd>/.pi/settings.json` has `packages: ["npm:pi-flows"]`
- **THEN** `PackageBrowser` renders a `PackageRow` with `source="npm:pi-flows"` and `sourceType="npm"`
- **AND** the row exposes `Update` and `Uninstall` buttons

#### Scenario: local-path row in workspace scope

- **WHEN** the workspace `<cwd>/.pi/settings.json` has `packages: ["/abs/path/my-ext"]`
- **THEN** `PackageBrowser` renders a `PackageRow` with `source="/abs/path/my-ext"` and `sourceType="local"`
- **AND** the row exposes a working `Uninstall` button

#### Scenario: git-source row in workspace scope

- **WHEN** the workspace `<cwd>/.pi/settings.json` has `packages: ["git@github.com:user/repo.git"]`
- **THEN** `PackageBrowser` renders a `PackageRow` with `sourceType="git"`
- **AND** the row exposes a working `Uninstall` button

#### Scenario: empty installed list does not render the section header

- **WHEN** the workspace settings.json `packages[]` is empty
- **AND** there are no recommended extensions installed
- **THEN** `PackageBrowser` does not render the "Installed Packages" section header (no empty heading)
- **AND** the search-results area renders normally

#### Scenario: showInstalledSection={false} suppresses the section even when packages exist

- **WHEN** `PackageBrowser` is mounted with `showInstalledSection={false}` and the scope has installed packages
- **THEN** the Installed Packages section header is NOT rendered
- **AND** no `PackageRow` for any installed package is rendered
- **AND** Settings → Add-ons relies on `UnifiedPackagesSection` (Add-ons) above to manage these rows

#### Scenario: dashboard-managed bridge rows are not listed

- **WHEN** `useInstalledPackages(scope, cwd)` returns a row with `dashboardManaged: true`
- **THEN** `PackageBrowser` SHALL NOT render a `PackageRow` for it
