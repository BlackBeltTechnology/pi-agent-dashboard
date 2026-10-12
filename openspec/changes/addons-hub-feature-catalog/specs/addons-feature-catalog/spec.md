## Purpose

Present add-ons as user-facing features instead of raw `packages[]` entries: join a dashboard plugin, its managed bridge and the pi packages it needs into one entry, say who delivers it, and switch it on or off as one unit.

## ADDED Requirements

### Requirement: The server SHALL join add-on parts into features

`GET /api/addons/catalog` SHALL return every global-scope add-on as a feature. Joining rules, applied in order:
1. Each discovered dashboard plugin SHALL start a feature (id `plugin:<pluginId>`).
2. An installed package whose `package.json` name equals the plugin's package name SHALL join that plugin's feature.
3. A `dashboardManaged` row whose path is the plugin's recorded bridge SHALL join that plugin's feature as its bridge.
4. An installed package named in the plugin's `requires.piExtensions` SHALL join that plugin's feature, unless more than one discovered plugin requires it; then it SHALL form its own feature listing every requiring plugin as `requiredBy`.
5. A recommended manifest entry's `dashboardPlugin` link SHALL join that entry's installed package to the named plugin's feature.
6. Every remaining installed package SHALL form its own feature (id `pkg:<identity>`), using pi's package identity (npm name, git URL without ref, resolved path).
7. The pi core agent SHALL form the `core:pi` feature; the dashboard bridge extension SHALL form `core:dashboard-bridge`.

Each package SHALL belong to exactly one feature. Each feature SHALL carry: `id`, `displayName`, `description`, `kind` (`core` | `agent-and-dashboard` | `dashboard-only` | `agent-only`), `origin`, the dashboard-plugin part (id, enabled, loaded, error, has-settings) when present, the bridge path when present, and the pi package parts (source, scope, version, update-available, contents counts for extensions, skills, prompts and themes).

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

#### Scenario: Built-in plugin without a package
- **WHEN** plugin `gmail` is discovered from the dashboard bundle and no installed package joins it
- **THEN** feature `plugin:gmail` SHALL have kind `dashboard-only` and no pi package parts

#### Scenario: Plain pi package
- **WHEN** `npm:pi-web-access` is installed and no plugin claims it
- **THEN** it SHALL be a `pkg:` feature of kind `agent-only`

### Requirement: Each feature SHALL state who delivers it

Origin SHALL be derived, not configured:
- `first-party` — every part is from pi-dashboard: the plugin is first-party (the plugin row's `firstParty`, or bundled with the dashboard) and every pi package is in the `@blackbelt-technology/` npm scope or a local checkout of such a package (by `package.json` name);
- `mixed` — a first-party dashboard plugin joined with a pi package that is not first-party; the feature SHALL carry that package's author label (npm scope, else package name);
- `community` — no first-party part;
- `upstream` — the `core:pi` feature.

#### Scenario: Mixed origin
- **WHEN** feature `plugin:goal` joins first-party plugin `goal` with `@ricoyudog/pi-goal-hermes`
- **THEN** its origin SHALL be `mixed` with author label `@ricoyudog`

#### Scenario: Local checkout of a first-party package
- **WHEN** `/repo/packages/eng-disciplines` is installed and its `package.json` name is `@blackbelt-technology/pi-dashboard-eng-disciplines`
- **THEN** its feature origin SHALL be `first-party`

### Requirement: A feature SHALL be switched on and off as one unit

`POST /api/addons/:featureId/toggle` with `{ enabled: false }` SHALL:
1. disable the feature's dashboard plugin through the existing plugin toggle path (when it has one);
2. for each of the feature's pi packages that no other enabled feature requires, rewrite its global `packages[]` entry into pi's object form with `extensions`, `skills`, `prompts` and `themes` all set to `[]`, after recording the exact previous entry in the dashboard's machine-local ownership store;
3. leave on every pi package another enabled feature requires, and list it in the response as `keptOn` with the requiring feature ids.

`{ enabled: true }` SHALL restore each recorded previous entry exactly, delete the record, and enable the plugin. A package entry with no record SHALL be left unchanged on enable. The response SHALL report `restartRequired` (plugin side) and the affected sources, so the client can offer its existing session-reload prompt. The endpoint SHALL be auth-gated like the plugin toggle, SHALL serialise with other package and resource writes, SHALL return 404 for an unknown feature, 409 when the settings file is unparseable, and 400 for `core:*` features. Every toggle SHALL log one line naming the feature, the plugin toggled, sources filtered or restored, and sources kept on.

#### Scenario: Disable Goal
- **WHEN** the user turns off feature `plugin:goal`
- **THEN** plugin `goal` SHALL be disabled
- **AND** the `npm:@ricoyudog/pi-goal-hermes` entry SHALL become `{ "source": "npm:@ricoyudog/pi-goal-hermes", "extensions": [], "skills": [], "prompts": [], "themes": [] }`
- **AND** the response SHALL report `restartRequired: true`

#### Scenario: Re-enable restores the exact previous entry
- **GIVEN** the entry was an object with `"skills": ["!skills/legacy"]` before it was turned off
- **WHEN** the feature is turned back on
- **THEN** the entry SHALL equal the recorded original byte-for-byte after JSON normalisation
- **AND** the ownership record SHALL be removed

#### Scenario: Shared package stays on
- **GIVEN** `x-ext` is required by enabled features `plugin:a` and `plugin:b`
- **WHEN** the user turns off `plugin:a`
- **THEN** `x-ext` SHALL keep loading
- **AND** the response SHALL list `x-ext` in `keptOn` with `plugin:b`

#### Scenario: Core cannot be toggled
- **WHEN** a client posts a toggle for `core:pi`
- **THEN** the server SHALL respond 400 and SHALL NOT write any file

#### Scenario: Unparseable settings
- **WHEN** `~/.pi/agent/settings.json` cannot be parsed
- **THEN** the server SHALL respond 409 and SHALL NOT disable the plugin

### Requirement: The Installed tab SHALL render one row per feature

The Add-ons Installed tab SHALL render one row per catalog feature with: name, description, origin badge, part chips (dashboard UI, extension, bridge, skills, prompts, themes with counts), version, update badge, a single on/off switch for toggleable features, and an expander. The expander SHALL show a "For the AI agent (pi)" panel (packages, published variant, bridge marked managed, contents, delivered by) and a "For this dashboard" panel (plugin id and status, delivered by, depends on, required by) plus actions (Settings, README, Update, Move scope, Uninstall when the feature has an uninstallable package). Turning a switch off on a feature with a pi part SHALL first show a confirmation naming what stops (dashboard UI and/or the AI-agent part) and any package kept on.

#### Scenario: Goal row
- **WHEN** the Installed tab renders feature `plugin:goal`
- **THEN** one row SHALL show the `dashboard UI · ext by @ricoyudog` badge and chips `dashboard UI`, `bridge`, `extension`

#### Scenario: Confirm before a combined off
- **WHEN** the user switches off `plugin:goal`
- **THEN** a confirmation SHALL say that both the dashboard UI and the AI-agent part stop
- **AND** nothing SHALL be written until the user confirms

### Requirement: The Installed tab SHALL support origin filters and grouping

The Installed tab SHALL render a "Delivered by" strip with counts per origin, filter chips `From pi-dashboard` (first-party or mixed), `Community` (community or mixed), `Has dashboard UI`, `Agent only`, `Local source`, `Disabled`, and a grouping control with `by kind` (default), `by who delivers it`, `by install source` and `A–Z`. Group headings SHALL use plain language: "Agent + dashboard features", "Dashboard-only features", "Agent-only features", "Core".

#### Scenario: Group by who delivers it
- **WHEN** the user selects `by who delivers it`
- **THEN** rows SHALL be grouped under "Delivered by pi-dashboard", "pi-dashboard UI for community extensions", "Community packages" and "pi core"

### Requirement: The Add-ons page SHALL have Installed, Updates and Discover tabs

The Updates tab SHALL list every feature with an available update plus pi core, each with an Update action and a "What's new" link where a changelog exists, and one "Update all" that enqueues each through the existing package queue. The Discover tab SHALL hold the recommended-not-installed cards (with origin badge and part chips), npm search, type filter and install-from-source input. Tab counts SHALL show installed features and available updates. The selected tab SHALL be addressable by URL query so it survives reload.

#### Scenario: Update all
- **GIVEN** three features and pi core have updates
- **WHEN** the user clicks "Update all"
- **THEN** four operations SHALL be enqueued FIFO in the existing package queue

#### Scenario: Tab survives reload
- **WHEN** the user opens the Discover tab and reloads
- **THEN** the Discover tab SHALL be selected
