## Purpose

Answer, for one folder, what a newly started session there will load, and let the user turn a global add-on's AI-agent part off for that folder only.

## ADDED Requirements

### Requirement: The folder catalog SHALL report per-feature folder state

`GET /api/addons/catalog?scope=folder&cwd=<abs>` SHALL return the global features plus folder-scope features, each with a `folderState`:
- `added-here` — the feature's pi package is declared in the folder's `.pi/settings.json` as a normal (non-delta) entry;
- `off-here` — a global feature whose every pi package has a project-scope delta with all four resource types set to `[]`;
- `partly-off-here` — a global feature with a project delta that narrows but does not empty it;
- `inherited` — any other global feature with a pi part;
- `dashboard-only` — a feature without a pi part.

A folder package entry that narrows its own resources SHALL report the number of resources that load versus the package total. The response SHALL include counts of loose resources under `<cwd>/.pi` (skills, agents, prompts, extensions, themes). The `cwd` SHALL be validated with the same rules as other folder-scoped package routes; an invalid or unknown cwd SHALL return 400.

#### Scenario: Repo that loads one extension of itself
- **GIVEN** `<cwd>/.pi/settings.json` has `{ "source": "<cwd>", "extensions": ["+packages/kb-extension/src/index.ts"] }`
- **WHEN** the folder catalog is requested
- **THEN** that feature SHALL have `folderState: "added-here"` and report 1 loading extension out of its total

#### Scenario: Global feature turned off here
- **GIVEN** the folder has the all-empty delta for `npm:pi-web-access`
- **WHEN** the folder catalog is requested
- **THEN** feature `pkg:pi-web-access` SHALL have `folderState: "off-here"`

### Requirement: The folder toggle SHALL write a pi-standard project delta

`POST /api/addons/:featureId/toggle` with `{ scope: "folder", cwd, enabled: false }` SHALL, for each pi package of the feature, write a project-scope entry `{ source, autoload: false, extensions: [], skills: [], prompts: [], themes: [] }` to `<cwd>/.pi/settings.json`, matched by pi package identity, replacing an existing dashboard-written delta for the same identity, and SHALL record ownership machine-locally. With `enabled: true` it SHALL remove only the delta it owns; a user-authored delta SHALL be left in place and reported as `notOwned`. The folder toggle SHALL NOT change any dashboard plugin. It SHALL go through the folder trust gate: when a trust decision is needed it SHALL NOT write and SHALL return `trust_required`. It SHALL return 400 for `dashboard-only` and `core:*` features, and for `added-here` features (those are removed by uninstalling from the folder).

#### Scenario: Turn off pi-web-access in one folder
- **WHEN** the user turns off `pkg:pi-web-access` for `/repo`
- **THEN** `/repo/.pi/settings.json` SHALL contain `{ "source": "npm:pi-web-access", "autoload": false, "extensions": [], "skills": [], "prompts": [], "themes": [] }`
- **AND** `~/.pi/agent/settings.json` SHALL be unchanged
- **AND** a session newly started in `/repo` SHALL NOT load pi-web-access while one started elsewhere SHALL

#### Scenario: Plugin feature off here keeps the dashboard UI
- **WHEN** the user turns off `plugin:goal` for `/repo`
- **THEN** only the `@ricoyudog/pi-goal-hermes` delta SHALL be written
- **AND** plugin `goal` SHALL stay enabled

#### Scenario: Untrusted folder
- **GIVEN** `/repo` has no recorded trust decision and the default is `ask`
- **WHEN** the user turns off a feature there
- **THEN** no file SHALL be written and the response SHALL be `trust_required`

#### Scenario: Re-enable removes only our delta
- **GIVEN** the delta for `npm:pi-web-access` was written by the user by hand
- **WHEN** the user turns the feature back on here
- **THEN** the entry SHALL remain and the response SHALL report it as `notOwned`

### Requirement: The folder Add-ons page SHALL show what sessions here load

The folder Add-ons page SHALL render, in order: a heading "Add-ons in this folder" with a Global / This folder switch; an effective-set strip showing *from Global* (features with a pi part), *added in this folder* (features + loose files), *turned off here*, and the resulting total, with the note that changes apply to new sessions started here; a collapsible explainer of Global / Added in this folder / Turned off here that also states dashboard plugins always apply to every folder; tabs **What loads here** and **Discover**.

**What loads here** SHALL contain the groups **Added in this folder** (folder features plus one "Your files in .pi/" row with counts and a link to the Resources pages), **From Global** (one row per global feature with a pi part, scope badge `global`, origin badge, part chips, an `off in this folder` badge when off, and an "on here" switch), and **Dashboard-only features** (collapsed by default). Filter chips `Added here` and `Turned off here` and a text filter SHALL narrow the groups. A row of a plugin-backed feature that is off here SHALL state that the dashboard UI stays because plugins are global. **Discover** SHALL list recommended entries not active in this folder and offer install with folder scope as the default.

#### Scenario: Strip arithmetic
- **GIVEN** 31 global features with a pi part, 1 folder package, 29 loose skills, and 1 global feature off here
- **WHEN** the page renders
- **THEN** the strip SHALL read 31 from Global, 1 + 29 files added here, 1 turned off here, and a total of 31 add-ons + 29 own files

#### Scenario: Switching a row updates the strip
- **WHEN** the user turns a From Global row off and the write succeeds
- **THEN** the row SHALL show `off in this folder`
- **AND** the strip's "turned off here" count SHALL increase by one without a page reload
- **AND** the existing reload-sessions offer SHALL appear for sessions running in this folder

#### Scenario: Trust prompt
- **WHEN** the toggle returns `trust_required`
- **THEN** the existing folder trust dialog SHALL open, and on approval the toggle SHALL be retried
