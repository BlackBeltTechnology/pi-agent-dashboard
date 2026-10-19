# addons-feature-catalog Specification

## Purpose
Present add-ons as user-facing features instead of raw `packages[]` entries: join a dashboard plugin, its managed bridge and the pi packages it needs into one entry, say who delivers it, and switch it on or off as one unit.

## Requirements

### Requirement: The server SHALL join add-on parts into features

`GET /api/addons/catalog` SHALL return every global-scope add-on as a feature. The pi core agent SHALL form the `core:pi` feature; the installed package whose `package.json` name is `@blackbelt-technology/pi-dashboard-extension` SHALL form `core:dashboard-bridge` (origin `first-party`). Each discovered dashboard plugin SHALL start a feature (id `plugin:<pluginId>`). Installed packages SHALL then be claimed in this precedence order; a package once claimed SHALL NOT be claimed again:
1. the global package whose `package.json` name equals the plugin's non-empty package name joins that plugin's feature (when several match, the first in `packages[]` order; the rest fall through);
2. a `dashboardManaged` row whose path is the plugin's bridge entry joins that plugin's feature as its bridge;
3. a package named in the `requires.piExtensions` of two or more discovered plugins SHALL form its own feature listing every requiring plugin as `requiredBy`;
4. a recommended manifest entry's `dashboardPlugin` link joins that entry's installed package to the named plugin's feature;
5. a package named in exactly one discovered plugin's `requires.piExtensions` joins that plugin's feature;
6. every remaining installed package SHALL form its own feature (id `pkg:<identity>`), using pi's package identity (npm name, git URL without ref, resolved path).

`kind` SHALL be derived: `core` for `core:*`; `agent-and-dashboard` when the feature has a dashboard plugin and at least one pi package part; `dashboard-only` when it has a dashboard plugin and no pi package part (a bridge alone does not count — it is the plugin's plumbing); `agent-only` when it has no dashboard plugin.

A requirement on a package already claimed by another feature SHALL be listed under the requiring feature's `requires` as a reference, not owned. A `dashboardManaged` row matching no discovered plugin SHALL be excluded from every feature. Every other installed package SHALL belong to exactly one feature.

Each feature SHALL carry: `id`, `displayName`, `description`, `kind` (`core` | `agent-and-dashboard` | `dashboard-only` | `agent-only`), `origin` (+ author label when `mixed`), `state` (`on` | `off` | `partial`), the dashboard-plugin part (id, enabled, loaded, error, has-settings, `missingRequirements`) when present, the bridge path when present, `requires`, `requiredBy`, and the pi package parts (source, scope, version, update-available, `publishedVariantSource`/`publishedVariantVersion` when present, contents counts for extensions, skills, prompts and themes). With 40 installed packages and 30 discovered plugins the catalog route SHALL answer within 300 ms at p95 (server-side, warm enricher cache). Features SHALL be ordered `core:*` first, then by `displayName` (case-insensitive), then by `id`. The catalog SHALL add no npm registry call beyond the installed-package enricher's existing cached lookup; the client SHALL overlay update availability onto package parts (matched by source) from its existing update-check results, and pi core versions from its existing pi-core version hook.

#### Scenario: Plugin with a required community extension
- **GIVEN** plugin `goal` requires `@ricoyudog/pi-goal-hermes`, has a managed bridge, and the package is installed globally
- **WHEN** the catalog is requested
- **THEN** one feature `plugin:goal` SHALL contain the plugin, the bridge and `npm:@ricoyudog/pi-goal-hermes`
- **AND** its kind SHALL be `agent-and-dashboard`
- **AND** no other feature SHALL contain that package or bridge

#### Scenario: Plugin delivered as an npm package with pi content
- **GIVEN** `npm:@blackbelt-technology/pi-dashboard-apple-tools` is installed and is the package of plugin `apple-tools`
- **WHEN** the catalog is requested
- **THEN** feature `plugin:apple-tools` SHALL contain that package and the plugin

#### Scenario: Package required by two plugins
- **GIVEN** plugins `a` and `b` both list `x-ext` in `requires.piExtensions`
- **WHEN** the catalog is requested
- **THEN** `x-ext` SHALL be its own feature with `requiredBy` = [`a`, `b`]
- **AND** neither plugin feature SHALL contain it

#### Scenario: Own package wins over another plugin's requirement
- **GIVEN** package `p` is the package of plugin `a` and is listed in plugin `b`'s `requires.piExtensions`
- **WHEN** the catalog is requested
- **THEN** `p` SHALL belong to `plugin:a`
- **AND** `plugin:b` SHALL list `p` under `requires` without owning it

#### Scenario: Built-in plugin without a package
- **WHEN** plugin `gmail` is discovered from the dashboard bundle and no installed package joins it, with or without a managed bridge
- **THEN** feature `plugin:gmail` SHALL have kind `dashboard-only` and no pi package parts

#### Scenario: Shared requirement beats a manifest link
- **GIVEN** recommended entry `x-ext` links `dashboardPlugin: a` and plugins `a` and `b` both require `x-ext`
- **WHEN** the catalog is requested
- **THEN** `x-ext` SHALL be its own feature with `requiredBy` = [`a`, `b`]

#### Scenario: Plain pi package
- **WHEN** `npm:example-pi-tool` is installed and no plugin's package, bridge, manifest link or requirement names it
- **THEN** it SHALL be a `pkg:` feature of kind `agent-only`

#### Scenario: Orphaned managed bridge row
- **WHEN** a `dashboardManaged` row matches no discovered plugin's bridge entry
- **THEN** no feature SHALL contain it

### Requirement: Each feature SHALL state who delivers it

Origin SHALL be derived, not configured. A part is first-party when its plugin package is a first-party plugin package, or its package `package.json` name is in the `@blackbelt-technology/` npm scope (including a local checkout of such a package):
- `first-party` — every part is first-party;
- `mixed` — at least one first-party and at least one non-first-party part; the feature SHALL carry the distinct author labels of its non-first-party parts, joined with ", ", in part order (each label: npm scope; else the unscoped npm name; for git sources `<owner>/<repo>`; for local paths the `package.json` name);
- `community` — no first-party part;
- `upstream` — the `core:pi` feature.

The UI badge labels map as: `first-party` → `pi-dashboard`, `mixed` → `dashboard UI · ext by <author>`, `community` → `community`, `upstream` → `pi core`.

#### Scenario: Mixed origin
- **WHEN** feature `plugin:goal` joins first-party plugin `goal` with `@ricoyudog/pi-goal-hermes`
- **THEN** its origin SHALL be `mixed` with author label `@ricoyudog`

#### Scenario: Local checkout of a first-party package
- **WHEN** `/repo/packages/eng-disciplines` is installed and its `package.json` name is `@blackbelt-technology/pi-dashboard-eng-disciplines`
- **THEN** its feature origin SHALL be `first-party`

#### Scenario: Git-installed community package author label
- **WHEN** a non-first-party part is installed from `git:github.com/alice/pi-tool@v1`
- **THEN** the author label SHALL be `alice/pi-tool`

### Requirement: A feature SHALL be switched on and off as one unit

A feature's `state` SHALL be `on` when its plugin (if any) is enabled and none of its owned package entries is the all-empty filter form; `off` when its plugin (if any) is disabled and every owned package entry is the all-empty filter form; `partial` otherwise. The all-empty filter form is an object entry whose `extensions`, `skills`, `prompts` and `themes` are all `[]`; any other user filter counts as on.

`POST /api/addons/:featureId/toggle` with `{ enabled: false }` SHALL, as one operation serialised with every other write to the global settings file, with plugin-config writes, and with package install/update/remove:
1. compute the plugin dependency cascade; every feature owning a dependent plugin SHALL be turned off with it and listed in the response as `cascaded`;
2. for each owned pi package of the affected features that is not required by an enabled plugin outside the operation: if it is already in the all-empty filter form with a restore record, leave entry and record unchanged; otherwise record the exact previous entry and the filtered value in the dashboard's machine-local restore store, then rewrite its global `packages[]` entry in place into the all-empty filter form;
3. disable the affected dashboard plugins through the shared plugin-toggle function (a managed bridge follows its plugin through the existing bridge sync on server restart; the toggle does not write bridge entries);
4. leave on every owned pi package an enabled plugin outside the operation requires, listing it as `keptOn` with the requiring feature ids — the owning feature then reports `partial`;
5. report as `stillLoadedIn` every known directory whose `.pi/settings.json` lists one of the filtered packages, excluding entries with `autoload: false` and entries in the all-empty filter form, resolving local sources against that folder's `.pi` directory (read-only; unparseable files skipped).

Turning off a `pkg:` feature that has `requiredBy` SHALL filter the package without changing the requiring plugins; the response SHALL list them as `requiredBy`.

`{ enabled: true }` SHALL enable the plugin (with the existing dependency cascade, listing cascaded features), then for each owned package of the affected features, including cascaded features: when a record exists and the current entry equals the recorded filtered value, restore the recorded entry and delete the record; when a record exists and the current entry already equals the recorded original, delete the record and report it as restored; when a record exists and the entry differs from both, leave it unchanged, keep the record, and list it in `restoreSkipped` with reason `edited`; when no record exists and the entry is in the all-empty filter form, leave it unchanged and list it in `restoreSkipped` with reason `no-record` (the hub never rewrites a filter it did not write); otherwise leave it unchanged. Entry equality SHALL be JSON-value equality. Toggling a `partial` feature SHALL be treated as `{ enabled: false }` by the client.

Restore records whose settings path + identity no longer matches a global `packages[]` entry (package uninstalled, reset to its published variant, or moved scope) SHALL be deleted when the catalog is built or a toggle runs, so a later reinstall starts with no record.

When the global `packages[]` holds more than one entry with the same identity as an affected package, the server SHALL respond 409 `duplicate-entries` and write nothing (duplicates are resolved in the package health panel).

If the plugin step fails after entries were filtered, the entries SHALL be restored and records deleted before responding 500. If the restore step fails after plugins were enabled, those plugins SHALL be disabled again before responding 500. If a compensating write itself fails, the server SHALL keep the restore records, log the failure and respond 500 with `consistent: false`. The response SHALL report `restartRequired`, `cascaded`, `filtered`, `restored`, `keptOn`, `requiredBy`, `restoreSkipped` and `stillLoadedIn`. With 50 known directories a dry run SHALL answer within 500 ms at p95. A request with `dryRun: true` SHALL compute and return the same response fields plus a `confirmToken` (digest of the report) without writing any file. A non-dry-run request carrying a `confirmToken` SHALL recompute the report under the locks and, when the digest differs, respond 409 `stale-confirmation` with the fresh report and write nothing. The endpoint SHALL use the same network guard as the plugin toggle, SHALL return 404 for an unknown feature, 409 when the settings file is unparseable or a package operation is running, 409 with blockers when enabling is blocked by a missing plugin dependency, and 400 for `core:*` features. Every non-dry-run toggle SHALL log one line naming the feature, cascaded features, plugins toggled, sources filtered or restored, sources kept on and folders still loading.

#### Scenario: Disable Goal
- **WHEN** the user turns off feature `plugin:goal`
- **THEN** plugin `goal` SHALL be disabled
- **AND** the `npm:@ricoyudog/pi-goal-hermes` entry SHALL become `{ "source": "npm:@ricoyudog/pi-goal-hermes", "extensions": [], "skills": [], "prompts": [], "themes": [] }` at the same array index
- **AND** the response SHALL report `restartRequired: true`

#### Scenario: Re-enable restores the exact previous entry
- **GIVEN** the entry was an object with `"skills": ["!skills/legacy"]` before it was turned off
- **WHEN** the feature is turned back on
- **THEN** the entry SHALL be JSON-value equal to the recorded original
- **AND** the restore record SHALL be removed

#### Scenario: Package another enabled plugin requires stays on
- **GIVEN** package `p` belongs to `plugin:a` and enabled plugin `b` lists `p` in `requires.piExtensions`
- **WHEN** the user turns off `plugin:a`
- **THEN** `p` SHALL keep loading
- **AND** the response SHALL list `p` in `keptOn` with `plugin:b`
- **AND** `plugin:a` SHALL report state `partial`

#### Scenario: Second off keeps the original record
- **GIVEN** the feature is off with a restore record holding the original entry
- **WHEN** an off toggle is posted again
- **THEN** the entry and the record SHALL be unchanged

#### Scenario: Dry run writes nothing
- **WHEN** a client posts `{ enabled: false, dryRun: true }` for `plugin:goal`
- **THEN** the response SHALL list the sources that would be filtered
- **AND** no settings, plugin config or restore file SHALL change

#### Scenario: Duplicate entries refuse the toggle
- **GIVEN** global `packages[]` holds `npm:x` and `npm:x@1`
- **WHEN** the user turns off the feature owning `x`
- **THEN** the server SHALL respond 409 `duplicate-entries` and write nothing

#### Scenario: Dependent feature cascades fully off
- **GIVEN** plugin `apple-tools` depends on plugin `mcp-client` and both features are on
- **WHEN** the user turns off `plugin:mcp-client`
- **THEN** both plugins SHALL be disabled and the pi packages of both features SHALL be filtered
- **AND** the response SHALL list `plugin:apple-tools` in `cascaded`

#### Scenario: Folder keeps loading the package
- **GIVEN** known directory `/repo` has `.pi/settings.json` listing `npm:@ricoyudog/pi-goal-hermes`
- **WHEN** the user turns off `plugin:goal`
- **THEN** the response SHALL list `/repo` under `stillLoadedIn` for that source
- **AND** `/repo/.pi/settings.json` SHALL NOT be written

#### Scenario: Hand-edited entry is not overwritten
- **GIVEN** the feature is off and the user edited the filtered entry by hand
- **WHEN** the feature is turned on
- **THEN** the entry SHALL stay as edited and be listed in `restoreSkipped`

#### Scenario: Enable restores cascaded features
- **GIVEN** `plugin:mcp-client` and `plugin:apple-tools` were turned off together
- **WHEN** the user turns on `plugin:apple-tools`
- **THEN** both plugins SHALL be enabled and both features' recorded entries restored

#### Scenario: Enable without a record
- **GIVEN** the entry is the all-empty filter form and no restore record exists
- **WHEN** the feature is turned on
- **THEN** the entry SHALL stay unchanged
- **AND** the response SHALL list it in `restoreSkipped` with reason `no-record`

#### Scenario: Leftover record after an interrupted enable
- **GIVEN** a restore record exists and the entry already equals its recorded original
- **WHEN** the feature is turned on
- **THEN** the record SHALL be deleted and the source reported as restored

#### Scenario: Stale confirmation
- **GIVEN** a dry run returned a `confirmToken` and a new plugin requiring the package was enabled afterwards
- **WHEN** the toggle is posted with that token
- **THEN** the server SHALL respond 409 `stale-confirmation` with the fresh report and write nothing

#### Scenario: Record removed after uninstall
- **GIVEN** a restore record exists for `npm:x` and `npm:x` was uninstalled
- **WHEN** the catalog is built
- **THEN** the record SHALL be deleted

#### Scenario: Plugin step fails during disable
- **WHEN** disabling the plugin fails after the package entry was filtered
- **THEN** the entry SHALL be restored, the record deleted, and the server SHALL respond 500

#### Scenario: Core cannot be toggled
- **WHEN** a client posts a toggle for `core:pi`
- **THEN** the server SHALL respond 400 and SHALL NOT write any file

#### Scenario: Unparseable settings
- **WHEN** `~/.pi/agent/settings.json` cannot be parsed
- **THEN** the server SHALL respond 409 and SHALL NOT disable the plugin

#### Scenario: Package operation running
- **WHEN** a package install is running and a toggle is posted
- **THEN** the server SHALL respond 409 and SHALL NOT write any file

### Requirement: The Installed tab SHALL render one row per feature

The Add-ons Installed tab SHALL render one row per catalog feature with: name, description, origin badge, part chips (dashboard UI, extension, bridge, skills, prompts, themes with counts), version and update badge per package part, a single on/off control for toggleable features, styled as a switch with checkbox semantics (`role="checkbox"`) so a `partial` feature exposes `aria-checked="mixed"` and a visible "partly on" label, and an expander. The expander SHALL show a "For the AI agent (pi)" panel (packages, published variant, bridge marked managed, contents, delivered by) and a "For this dashboard" panel (plugin id and status, missing requirements with the existing install pill, delivered by, depends on, required by) plus actions per package part (Update, Reset to published version per `pi-core-version-ui`, Move scope, Uninstall) and per feature (Settings, README). A package part is uninstallable unless it is a `core:*` part or a `dashboardManaged` bridge; a dashboard plugin without a package part has no Uninstall. When the off confirmation lists `keptOn` packages it SHALL name the requiring features with a link to each row. The package health panel SHALL NOT render above the feature list; it renders inside the Add-ons Issues tab (`addons-issues`). Turning a switch off on a feature with a pi part or a cascade SHALL first request a dry run and show a confirmation naming what stops (dashboard UI and/or the AI-agent part), cascaded features, packages kept on, requiring plugins, and folders that keep loading. After a successful toggle the existing session-reload prompt SHALL be offered.

#### Scenario: Goal row
- **WHEN** the Installed tab renders feature `plugin:goal`
- **THEN** one row SHALL show the `dashboard UI · ext by @ricoyudog` badge and chips `dashboard UI`, `bridge`, `extension`

#### Scenario: Confirm before a combined off
- **WHEN** the user switches off `plugin:goal`
- **THEN** a confirmation SHALL say that both the dashboard UI and the AI-agent part stop
- **AND** nothing SHALL be written until the user confirms

#### Scenario: Partial feature
- **GIVEN** plugin `goal` was disabled from the Plugins index and its package entry is unfiltered
- **WHEN** the Installed tab renders `plugin:goal`
- **THEN** its control SHALL expose `aria-checked="mixed"`
- **AND** activating it SHALL open the off confirmation

### Requirement: The Installed tab SHALL offer a Delivered-by strip and grouping

The Installed tab SHALL render a "Delivered by" strip with feature counts for each of the four origins and a grouping control with `by kind` (default), `by who delivers it`, `by install source` and `A–Z`. Group headings SHALL be: by kind — "Core", "Agent + dashboard features", "Dashboard-only features", "Agent-only features"; by who delivers it — `first-party` → "Delivered by pi-dashboard", `mixed` → "pi-dashboard UI for community extensions", `community` → "Community packages", `upstream` → "pi core"; by install source (the most local owned package source wins: local > git > npm; no package → built in) — "npm", "git", "Local folder", "Built into the dashboard"; `A–Z` — no headings. A group with no row matching the active filters SHALL be hidden.

#### Scenario: Group by who delivers it
- **WHEN** the user selects `by who delivers it`
- **THEN** rows SHALL be grouped under "Delivered by pi-dashboard", "pi-dashboard UI for community extensions", "Community packages" and "pi core"

### Requirement: The Add-ons page SHALL have Installed, Updates and Discover tabs

The Updates tab SHALL list every feature with an available update plus pi core, each with an Update action and a "What's new" link where a changelog exists, and one "Update all" that enqueues one operation per updatable package part plus pi core through the existing package queue (pi core via its existing queue entry). The Discover tab SHALL hold the recommended-not-installed cards (with origin badge and part chips), npm search, type filter and install-from-source input. Tab labels SHALL show the installed feature count and the available update count. The selected tab SHALL be addressable by the `tab` URL query (`installed` | `updates` | `discover`) so it survives reload; an unknown value SHALL select Installed.

#### Scenario: Update all
- **GIVEN** three package parts (in two features) and pi core have updates
- **WHEN** the user clicks "Update all"
- **THEN** four operations SHALL be enqueued FIFO in the existing package queue

#### Scenario: Tab survives reload
- **WHEN** the user opens the Discover tab and reloads
- **THEN** the Discover tab SHALL be selected

#### Scenario: Unknown tab value
- **WHEN** the page opens with `?tab=bogus`
- **THEN** the Installed tab SHALL be selected
