## MODIFIED Requirements

### Requirement: Models nav group

The settings navigation SHALL render a **Models** group as its FIRST group. It SHALL contain the built-in **Providers** page followed by every PROMOTED plugin page, ordered by the promotion's `order` (ascending, default 1000), then `nav.label`, then plugin id. The group SHALL render even when no plugin is promoted (Providers alone). The **Resources** group SHALL likewise list its built-in pages (Skills, Agents, Extensions, Prompts, Themes) first, followed by every plugin page PROMOTED into `resources`, in the same order. The rules below (trust, reserved labels, uniqueness, health dot, disabled handling, active entry, Save Bar label) apply to every allowlisted group; "Models" in them stands for the promoting group.

A plugin page is PROMOTED into a group when ALL of the following hold: the plugin declares a `settings-section` claim carrying a `nav` hint whose `group` names that group; the group id is on the host's promotion allowlist, which SHALL contain exactly `models` and `resources`; the plugin is TRUSTED — its npm package name is in the `@blackbelt-technology/` scope, the host's existing scope-based trust signal (NOT manifest `priority`, which is plugin-authored and doubles as slot render order); and `nav.label` does not collide with any RESERVED label — every built-in settings page label and every nav group label, in the English source AND in every shipped locale (a static set, so the outcome never depends on the active language) — compared after Unicode NFKC normalisation, trimming and case-folding. Among promoted hints, labels SHALL also be unique: when two promoted hints collide, the one that sorts first (by `order`, then plugin id) wins and the other plugin SHALL remain an ordinary Plugins child. First-party status SHALL be computed once by the server and exposed on the `GET /api/plugins` row as a boolean `firstParty`; the client SHALL NOT re-derive it. (`firstParty` is deliberately not named `trusted`: the server's spawn/abort hooks use a different, `priority`-based gate.) A hint failing any condition SHALL be ignored and the plugin SHALL remain an ordinary Plugins child. When a plugin declares more than one `nav`-bearing `settings-section` claim, the first one in manifest order that satisfies every condition SHALL be honoured; the rest SHALL be ignored.

A promoted entry SHALL use `nav.label` as its rail label, the host's generic plugin icon (the hint carries no icon), and the same health dot (`loaded` / `not loaded` / `error`) a Plugins child shows, and SHALL link to `/settings/plugins/<pluginId>` — promotion changes placement, never the URL. On that URL the promoted entry, not the Plugins pointer row, SHALL be the single active nav entry.

A promoted plugin that is installed but DISABLED SHALL remain in the Models group, rendered dimmed with an "off" marker, and its page SHALL render the disabled notice with a re-enable affordance. Its plugin activation index row SHALL state that it is shown in the Models group (not that it is absent from the navigation). A promoted plugin that is not installed SHALL NOT appear.

The Save Bar dirty-page label for a promoted page SHALL read `<Group> › <nav.label>` (e.g. `Models › Model roles`), and its dirty dot SHALL render on the promoted entry.

#### Scenario: Models group is first and holds Providers
- **WHEN** the user opens `/settings`
- **THEN** the first nav group SHALL be `Models`
- **AND** it SHALL contain `Providers`, and the `Extensions` group SHALL NOT contain `Providers`

#### Scenario: Trusted plugin is promoted
- **WHEN** plugin `roles` (package `@blackbelt-technology/pi-dashboard-roles-plugin`) is enabled and claims `{ slot: "settings-section", nav: { group: "models", label: "Model roles" } }`
- **THEN** the Models group SHALL contain a `Model roles` entry linking to `/settings/plugins/roles`

#### Scenario: Untrusted plugin hint is ignored
- **WHEN** plugin `x` from package `acme-dashboard-x` declares `priority: 100` and claims `settings-section` with `nav: { group: "models", label: "Model roles" }`
- **THEN** the Models group SHALL NOT contain an entry for `x`
- **AND** `x` SHALL be listed as an ordinary Plugins child

#### Scenario: Non-allowlisted group is ignored
- **WHEN** a first-party plugin claims `settings-section` with `nav: { group: "dashboard", label: "Foo" }`
- **THEN** no Dashboard entry SHALL be added for it
- **AND** it SHALL be listed as an ordinary Plugins child

#### Scenario: Label colliding with a built-in page is ignored
- **WHEN** a first-party plugin claims `settings-section` with `nav: { group: "models", label: " providers " }` or `label: "Security"`
- **THEN** the Models group SHALL NOT gain an entry with that label
- **AND** the plugin SHALL be listed as an ordinary Plugins child

#### Scenario: Group label and locale label are reserved
- **WHEN** a first-party plugin claims `nav: { group: "models", label: "Dashboard" }` or the Hungarian label of a built-in page
- **THEN** the hint SHALL be ignored regardless of the active locale

#### Scenario: Duplicate promoted labels
- **WHEN** first-party plugins `a` and `b` both claim `nav: { group: "models", label: "Budget" }` with equal `order`
- **THEN** the Models group SHALL contain one `Budget` entry, for plugin `a`
- **AND** `b` SHALL be listed as an ordinary Plugins child

#### Scenario: Failed promoted plugin shows an error dot
- **WHEN** promoted plugin `roles` is enabled and its status is `{ loaded: false, error: "..." }`
- **THEN** its Models entry SHALL show an error-state health dot

#### Scenario: First eligible hint wins
- **WHEN** a first-party plugin declares two `settings-section` claims, the first with `nav.group: "dashboard"` and the second with `nav: { group: "models", label: "Model roles" }`
- **THEN** the plugin SHALL be promoted into Models as `Model roles`

#### Scenario: Promoted entry is the active entry
- **WHEN** the user is on `/settings/plugins/roles` and `roles` is promoted
- **THEN** exactly one nav entry SHALL be marked active: `Models › Model roles`

#### Scenario: Disabled promoted plugin stays reachable
- **WHEN** promoted plugin `roles` is disabled in config
- **THEN** the Models group SHALL still list `Model roles` with an "off" marker
- **AND** `/settings/plugins/roles` SHALL render the disabled notice and a re-enable affordance, without mounting the plugin body
- **AND** the Plugins subtree SHALL render no `Roles` pointer
- **AND** the activation index row for `roles` SHALL state it is shown in the Models group

#### Scenario: Save Bar names the promoted page
- **WHEN** the user edits a role assignment on the promoted page without saving
- **THEN** the Save Bar SHALL list `Models › Model roles` as dirty and the promoted entry SHALL show a dirty dot

#### Scenario: Trusted plugin is promoted into Resources
- **WHEN** plugin `skill-atlas` (package `@blackbelt-technology/pi-dashboard-skill-atlas-plugin`) is enabled and claims `{ slot: "settings-section", nav: { group: "resources", label: "Skill Atlas" } }`
- **THEN** the Resources group SHALL list `Skills`, `Agents`, `Extensions`, `Prompts`, `Themes`, then `Skill Atlas` linking to `/settings/plugins/skill-atlas`
- **AND** the Plugins subtree SHALL render a pointer row `Skill Atlas ↗ Resources` that is never marked active

#### Scenario: Resources label colliding with a built-in page is ignored
- **WHEN** a first-party plugin claims `nav: { group: "resources", label: "Skills" }`
- **THEN** the Resources group SHALL NOT gain a second `Skills` entry
- **AND** the plugin SHALL be listed as an ordinary Plugins child
