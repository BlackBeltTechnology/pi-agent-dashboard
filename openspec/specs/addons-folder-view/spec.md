# addons-folder-view Specification

## Purpose
Answer, for one folder, what a newly started session there will load, and let the user turn a global add-on's AI-agent part off for that folder only.

## Requirements

### Requirement: The folder catalog SHALL report per-feature folder state

`GET /api/addons/catalog?scope=local&cwd=<abs>` SHALL return the global features plus folder-scope features, each with a `folderState`. State is first computed per pi package of the feature. A project entry matches a package when `sourcesMatch` (`packages/shared/src/source-matching.ts`) holds after rebasing relative local sources to absolute from the directory of the settings file that contains them (pi's rule; `<cwd>/.pi` for project entries, `~/.pi/agent` for global ones). A missing `<cwd>/.pi/settings.json` means no project entries:
- package **added** — declared in `<cwd>/.pi/settings.json` as a normal (non-`autoload:false`) entry;
- package **off** — a project entry `{ autoload: false }` with `extensions`, `skills`, `prompts` and `themes` all `[]`;
- package **narrowed** — any other project `autoload: false` entry for that identity;
- package **inherited** — no project entry.

Feature roll-up, first match wins (folder-local facts before the global switch):
- `dashboard-only` — the feature has no pi part;
- `added-here` — any package is added;
- `off-here` — every pi package is off;
- `partly-off-here` — any package is off or narrowed, but not all are off;
- `off-globally` — the feature's global toggle (`addons-feature-catalog`) has it off;
- `inherited` — otherwise.

Each feature SHALL also carry `restoreRecorded` (a restore record exists on this machine for every off package). A folder package entry that narrows its own resources SHALL report the number of resources that load versus the package total. The response SHALL include counts of loose resources under `<cwd>/.pi` (skills, agents, prompts, extensions, themes) and, per feature, the number of package-contributed agents (pi deltas cannot filter agents, so they still load when the feature is off here). The `cwd` SHALL be absolute and normalised (400 otherwise) and SHALL pass the shared `admitCwd` guard (`@blackbelt-technology/pi-dashboard-shared/cwd-guard.js`, known folder — session cwd, pinned directory or workspace folder — or a subdirectory / linked worktree whose main checkout is one) with that guard's rejection status. The read SHALL be auth-gated like the global catalog and SHALL NOT be trust-gated. With 50 features and 500 loose `.pi` files the folder catalog join SHALL complete with p95 < 300 ms. When `<cwd>/.pi/settings.json` is unparseable the response SHALL carry `settingsError` and no folder state other than `inherited`/`dashboard-only`/`off-globally`.

#### Scenario: Repo that loads one extension of itself
- **GIVEN** `<cwd>/.pi/settings.json` has `{ "source": "..", "extensions": ["+packages/kb-extension/src/index.ts"] }`
- **WHEN** the folder catalog is requested
- **THEN** that feature SHALL have `folderState: "added-here"` and report 1 loading extension out of its total

#### Scenario: Global feature turned off here
- **GIVEN** the folder has the all-empty delta for `npm:pi-web-access`
- **WHEN** the folder catalog is requested
- **THEN** feature `pkg:pi-web-access` SHALL have `folderState: "off-here"`

#### Scenario: Multi-package feature with one package off
- **GIVEN** a feature with two pi packages and the all-empty delta for only one of them
- **WHEN** the folder catalog is requested
- **THEN** the feature SHALL have `folderState: "partly-off-here"`

#### Scenario: Feature off globally
- **GIVEN** `pkg:pi-web-access` is turned off on the global Add-ons page
- **WHEN** the folder catalog is requested
- **THEN** the feature SHALL have `folderState: "off-globally"`

#### Scenario: Folder delta outranks the global switch
- **GIVEN** `pkg:pi-web-access` is off globally and the folder has its all-empty delta
- **WHEN** the folder catalog is requested
- **THEN** the feature SHALL have `folderState: "off-here"`

#### Scenario: Read of an untrusted folder
- **GIVEN** `/repo` has no trust decision
- **WHEN** the folder catalog is requested for `/repo`
- **THEN** the response SHALL be 200 with folder states

#### Scenario: Workspace-only folder catalog
- **WHEN** the folder catalog is requested for a folder that is only in a workspace
- **THEN** it SHALL be admitted and report per-feature folder state

### Requirement: The folder toggle SHALL write a pi-standard project delta

`POST /api/addons/:featureId/toggle` with `{ scope: "local", cwd, enabled: false }` SHALL, for each pi package of the feature that is not kept on, write the project-scope entry `{ source, autoload: false, extensions: [], skills: [], prompts: [], themes: [] }` to `<cwd>/.pi/settings.json`, matched as in the folder catalog. A package is **kept on** when another feature (not the one being toggled) that is on or partial requires it — the exact `keptOn` predicate of the global toggle in `addons-feature-catalog`; it is listed in the response as `keptOn` with the requiring feature ids. When every package is kept on, nothing is written, the response is 200 with `changed: false`, and the folder state is unchanged.

When a project entry for the identity already exists (dashboard- or user-written), its exact previous form SHALL be recorded in the machine-local restore store of `addons-feature-catalog` (`recordRestore`), keyed by the canonical settings path (the `realpath` canonicalisation of `resource-toggle-trust.ts`) + package identity, then replaced. The written `source` is the global entry's source, rebased to an absolute path when it is a relative local path (a relative source would otherwise resolve against `<cwd>/.pi`). An existing record SHALL NOT be overwritten while it still matches the entry on disk; an entry that already is the all-empty delta is left as is (off is idempotent). A record that no longer matches (the entry was hand-edited after the record was made) is stale and is replaced by a record of the current entry, so the newer entry is never lost. Records and the settings write SHALL happen under the per-settings-file write lock keyed by the project settings path — the same key the folder-scope resource toggle uses; when the settings write fails, records created by this call SHALL be deleted.

With `enabled: true`, for each off package: when a record exists and the current entry is exactly the all-empty delta, restore the recorded previous entry exactly (or remove the entry when none existed) and delete the record. When the current entry differs from the all-empty delta (edited since), leave it, delete the record, and report it as `notOwned`. An all-empty delta with no record (written by hand or on another machine) SHALL be left in place and reported as `notOwned`, unless the request carries `removeUnowned: true`, in which case the project `autoload: false` entry for that identity SHALL be removed (never a normal entry). The client SHALL send `removeUnowned` only after a confirmation that shows the entry.

The response SHALL report the affected sources so the client can offer its existing session-reload prompt. Every folder toggle SHALL log one line naming the feature, cwd, sources written, restored or removed, and sources kept on. The folder toggle SHALL NOT change any dashboard plugin or managed bridge and SHALL NOT touch `~/.pi/agent/settings.json`. It SHALL be auth-gated like the global toggle and SHALL pass `resolveToggleTrust` before any write, with the same outcomes and wire form as the folder-scope resource toggle: a needed decision (including an inherited refusal) returns 403 with `trustRequired: true`, registers the outstanding trust challenge for that cwd exactly as the resource toggle does (so `POST /api/resources/trust` accepts the follow-up decision), and writes nothing; a refusal recorded for this folder or `defaultProjectTrust: never` returns 403 without `trustRequired`. It SHALL return 409 when `<cwd>/.pi/settings.json` is unparseable, 404 for an unknown feature, and 400 for `core:*` and `dashboard-only` features, and — for `enabled: false` only — for `off-globally` and `added-here` features (added-here packages are removed by uninstalling from the folder; re-enabling stays allowed so a mixed feature's off packages can still be restored).

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
- **THEN** no file SHALL be written and the response SHALL be 403 with `trustRequired: true`

#### Scenario: Existing narrowing delta is restored on re-enable
- **GIVEN** `/repo/.pi/settings.json` has `{ "source": "npm:pi-web-access", "autoload": false, "skills": ["-skills/a"] }`
- **WHEN** the user turns the feature off here and then back on
- **THEN** the entry SHALL again equal `{ "source": "npm:pi-web-access", "autoload": false, "skills": ["-skills/a"] }`

#### Scenario: Off twice keeps the original record
- **GIVEN** the narrowing delta above and the feature already turned off here once
- **WHEN** the user turns it off again and then back on
- **THEN** the entry SHALL again equal the original narrowing delta

#### Scenario: Re-enable leaves a hand-written all-empty delta
- **GIVEN** the all-empty delta for `npm:pi-web-access` has no restore record (committed by a teammate)
- **WHEN** the user turns the feature back on here
- **THEN** the entry SHALL remain and the response SHALL report it as `notOwned`
- **AND** a confirmed retry with `removeUnowned: true` SHALL remove exactly that entry

#### Scenario: Entry edited after off is not clobbered
- **GIVEN** the feature was turned off here and the delta was then hand-edited to `{ "source": "npm:pi-web-access", "autoload": false, "skills": [] }`
- **WHEN** the user turns the feature back on here
- **THEN** the edited entry SHALL remain, the record SHALL be deleted, and the response SHALL report it as `notOwned`
- **AND** a confirmed retry with `removeUnowned: true` SHALL remove that `autoload: false` entry

#### Scenario: Failed settings write leaves no record
- **GIVEN** writing `/repo/.pi/settings.json` fails
- **WHEN** the user turns a feature off there
- **THEN** the response SHALL be an error and no restore record created by the call SHALL remain

#### Scenario: Package required by an enabled plugin is kept on
- **GIVEN** feature B (on) requires pi package X, and X belongs to feature A
- **WHEN** the user turns A off for `/repo` and X is A's only package
- **THEN** no delta SHALL be written, the response SHALL be `changed: false` with X in `keptOn` naming B

#### Scenario: Unparseable project settings
- **GIVEN** `/repo/.pi/settings.json` is not valid JSON
- **WHEN** the user turns a feature off there
- **THEN** the response SHALL be 409 and the file SHALL be unchanged

### Requirement: The folder Add-ons page SHALL show what sessions here load

The folder Add-ons page SHALL render, in order: a heading "Add-ons in this folder" with a Global / This folder switch; an effective-set strip; a collapsible explainer of Global / Added in this folder / Turned off here that also states dashboard plugins always apply to every folder; tabs **What loads here** and **Discover**.

The strip SHALL show four counters:
- *from Global* — global features with a pi part in state `inherited`, `partly-off-here` or `off-here`;
- *added in this folder* — `added-here` features, plus loose `.pi/` files;
- *turned off here* — `off-here` features;
- *total* — (from Global − turned off here + added features) add-ons, plus the own-files count.

Features whose global state is off SHALL be excluded from every strip counter, whatever their folder state. It SHALL note that changes apply to new sessions started here.

**What loads here** SHALL contain three groups:
- **Added in this folder** — folder features with the existing update and uninstall actions of the folder manage surface, plus one "Your files in .pi/" row with counts and a link to the Resources pages;
- **From Global** — one row per global feature with a pi part. Each row shows the scope badge `global`, an origin badge, part chips, an `off in this folder` badge when off (`partly off here` when partly), and an "on here" switch (`aria-checked="mixed"` when partly off). For `off-globally` the switch is disabled with a "turned off globally" note. A `keptOn` reply leaves the switch on and names the requiring feature. A `notOwned` reply on an all-empty delta offers a confirmed "Remove this folder entry" action that retries with `removeUnowned: true`. When the feature has package agents, an off row notes they still load;
- **Dashboard-only features** — collapsed by default; features without a pi part.

Rows flagged `dashboardManaged` SHALL NOT render as rows; a managed bridge appears only as the `bridge` part chip of its feature.

Filter chips `Added here` and `Turned off here` and a text filter SHALL narrow the groups. A row of a plugin-backed feature that is off here SHALL state that the dashboard UI stays because plugins are global. When a folder toggle fails (409, 5xx or network error) the switch SHALL revert to its prior state, the strip SHALL stay unchanged, and the row SHALL show an inline error with the server message. **Discover** SHALL list recommended entries not active in this folder: entries with no feature (offered as install with folder scope as the default) and `off-here` features (shown with an "installed globally, off here" note and a "Turn on here" action that calls the folder toggle with `enabled: true` instead of Install).

#### Scenario: Own feature's plugin requirement does not keep it on
- **GIVEN** plugin `goal` requires `@ricoyudog/pi-goal-hermes`, which belongs to `plugin:goal`
- **WHEN** the user turns off `plugin:goal` for `/repo`
- **THEN** the delta for `@ricoyudog/pi-goal-hermes` SHALL be written and `keptOn` SHALL be empty

#### Scenario: Globally-off feature is not counted
- **GIVEN** a feature off globally that also has the all-empty delta here
- **WHEN** the page renders
- **THEN** it SHALL appear in no strip counter

#### Scenario: Strip arithmetic
- **GIVEN** 31 global features with a pi part (none off globally), 1 folder package, 29 loose skills, and 1 global feature off here
- **WHEN** the page renders
- **THEN** the strip SHALL read 31 from Global, 1 + 29 files added here, 1 turned off here, and a total of 31 add-ons + 29 own files

#### Scenario: Switching a row updates the strip
- **WHEN** the user turns a From Global row off and the write succeeds
- **THEN** the row SHALL show `off in this folder`
- **AND** the strip's "turned off here" count SHALL increase by one without a page reload
- **AND** the existing reload-sessions offer SHALL appear for sessions running in this folder

#### Scenario: Trust prompt
- **WHEN** the toggle returns 403 with `trustRequired: true`
- **THEN** the existing folder trust dialog SHALL open, its decision SHALL be accepted by `POST /api/resources/trust`, and on approval the toggle SHALL be retried

#### Scenario: Failed toggle reverts the row
- **GIVEN** the folder toggle responds 409
- **WHEN** the user turns a From Global row off
- **THEN** the switch SHALL be back on, the strip SHALL be unchanged, and the row SHALL show the server message inline

#### Scenario: Off-here feature in Discover
- **GIVEN** `pkg:pi-web-access` is a recommended entry and is `off-here`
- **WHEN** the Discover tab renders
- **THEN** it SHALL be listed with "installed globally, off here" and a "Turn on here" action, not Install

#### Scenario: Folder package keeps its manage actions
- **GIVEN** a package installed in this folder
- **WHEN** the What loads here tab renders
- **THEN** its row in Added in this folder SHALL offer the existing update and uninstall actions
