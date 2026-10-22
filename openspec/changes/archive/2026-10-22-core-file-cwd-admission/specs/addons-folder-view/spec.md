## MODIFIED Requirements

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
