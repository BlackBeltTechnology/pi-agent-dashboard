## MODIFIED Requirements

### Requirement: One decision order serves every consumer

The folder decision SHALL be: a cwd with no trust-requiring project resources is implicitly trusted; otherwise pi's nearest recorded entry for the cwd or an ancestor (true or false), read from the trust store of the pi agent directory in use, decides; otherwise, when `piTrustMirror.enabled` is true, dashboard trust covering the cwd decides trusted — taking precedence over `defaultProjectTrust`, including `"never"`; otherwise `defaultProjectTrust` decides. Server-side consumers SHALL evaluate dashboard trust over the durable and the live entries, with no folder proof (they observe the server's own folders); a bridge SHALL evaluate it over the snapshot and the live trust query. The bridge's session gate (`coverInteractive`) applies after this folder decision and only in the bridge; server-side consumers do not apply it. Every decision SHALL carry its source: the recorded pi entry path, "implicit", the dashboard source kind with its entry, or the default. Implicit trust SHALL be determined with pi's own function for trust-requiring resources, not a reimplementation. A session's command-line `--approve`/`--no-approve` is applied by pi before any of this, and `--no-extensions` keeps the bridge from deciding at all; both are outside the folder decision and SHALL be disclosed wherever dashboard trust is shown. Nothing in this decision SHALL write pi's trust store. The guarantee that a recorded pi entry wins holds at the moment the bridge reads the store and when no other extension answers `project_trust` before the bridge, because pi applies the first yes/no among extension handlers.

#### Scenario: Recorded pi refusal wins
- **WHEN** `trust.json` records `/r: false`, `/r` has `.pi/settings.json`, and `/r` is pinned
- **THEN** `/r` SHALL be untrusted

#### Scenario: Nearer recorded trust beats a farther refusal
- **WHEN** `trust.json` records `/a: false` and `/a/b: true`, and `/a/b/c` has `.pi/settings.json`
- **THEN** `/a/b/c` SHALL be trusted with source `/a/b`, whatever dashboard trust says

#### Scenario: No-approve flag wins in the session
- **WHEN** a session started with `--no-approve` is in a pinned folder
- **THEN** the folder's project resources SHALL NOT load in that session

#### Scenario: Dashboard trust fills the gap
- **WHEN** `trust.json` records nothing for `/r`, `/r` has `.pi/mcp.json`, `defaultProjectTrust` is `ask`, and `/r` is pinned
- **THEN** `/r` SHALL be trusted with source "pinned folder"

#### Scenario: Dashboard trust overrides a global never
- **WHEN** `defaultProjectTrust` is `never`, nothing is recorded for `/r`, `/r` has `.pi/mcp.json`, and `/r` is pinned
- **THEN** `/r` SHALL be trusted with source "pinned folder"

#### Scenario: Mirror disabled restores today's behaviour
- **WHEN** `piTrustMirror.enabled` is false and `/r` is pinned with nothing recorded in `trust.json`
- **THEN** the folder decision SHALL equal pi's own resolution, and the bridge SHALL return undecided, so a dashboard-spawned session in `/r` is not auto-trusted

#### Scenario: Deciding never writes trust.json
- **WHEN** any session resolves trust through dashboard trust
- **THEN** `~/.pi/agent/trust.json` SHALL be unchanged by that resolution

#### Scenario: Server consumer sees live trust
- **WHEN** nothing is recorded for `/r`, `/r` has `.pi/mcp.json`, and `/r` is trusted "until dashboard restarts" only
- **THEN** the server-side folder decision for `/r` SHALL be trusted with source "worktree-init (until dashboard restarts)"

### Requirement: The bridge decides at project_trust from the snapshot

At pi's `project_trust` event the bridge SHALL read `piTrustMirror` from the dashboard config file, pi's trust store file without taking pi's lock, with pi's own reading rules (a leading byte-order mark stripped, `null` values treated as absent; any other read, parse or shape-validation failure yields undecided; an absent file means nothing recorded), and the server-written snapshot, without caching any of them across events, and SHALL return trusted for this run only (never remembered) when the folder decision yields dashboard trust, else undecided. It SHALL contact the server only through the live trust query and only under that query's conditions; when the snapshot covers the cwd it SHALL NOT contact the server. Only dashboard-spawned headless sessions SHALL consult dashboard trust unconditionally; every other session (interactive, or headless not spawned by the dashboard) SHALL consult it only when `piTrustMirror.coverInteractive` is true. Whether a session is dashboard-spawned SHALL be captured once at bridge activation from the single-use spawn token, which the bridge SHALL remove from its process environment at activation, so a pi process started later by the agent never qualifies. Every error SHALL yield undecided. An undecided outcome that withholds trust a dashboard-spawned session would otherwise have had SHALL be logged with one reason code from: `forbidden-folder`, `recorded-entry`, `identity-mismatch`, `identity-weak`, `hook-changed`, `not-project-root`, `source-off`, `source-not-installed`, `choice-unreadable`, `store-unreadable`, `not-covered`, `not-covered-session`, `live-timeout`, `live-unreachable`, `live-refused`, `live-unsupported`, `live-rate-limited`, `live-not-covered`, `live-error`. With a snapshot of 1,000 entries and a cwd 20 levels deep, the snapshot part of the handler's decision SHALL complete with p95 below 20 ms. A bridge undecided only avoids a wrong yes: when pi's store is unreadable, pi's own startup may still fail on it.

#### Scenario: Snapshot answers without the server
- **WHEN** the server is stopped and a dashboard-spawned headless session starts in a pinned folder recorded in the snapshot
- **THEN** the session SHALL be trusted for that run

#### Scenario: Snapshot hit makes no server request
- **WHEN** a dashboard-spawned headless session starts in a pinned folder recorded in the snapshot and live entries exist
- **THEN** the bridge SHALL decide trusted without issuing a live trust query

#### Scenario: Uncovered folder
- **WHEN** a local session starts in a folder no snapshot entry covers and the snapshot records no live entries
- **THEN** the bridge SHALL return undecided without a live trust query and pi's own resolution SHALL apply

#### Scenario: Dashboard-spawned interactive session keeps pi's prompt by default
- **WHEN** a dashboard-spawned interactive session starts in a pinned folder and `coverInteractive` is false
- **THEN** the bridge SHALL return undecided and pi's own prompt SHALL apply

#### Scenario: Terminal pi covered when configured
- **WHEN** a terminal pi session starts in a pinned folder with `coverInteractive` true
- **THEN** the folder SHALL be trusted for that run without pi's prompt

#### Scenario: Nested pi started by the agent
- **WHEN** an agent in a dashboard-spawned session starts `pi --mode rpc` in another pinned folder and `coverInteractive` is false
- **THEN** that nested process SHALL NOT count as dashboard-spawned and SHALL return undecided

#### Scenario: Withheld trust is logged with a reason code
- **WHEN** a dashboard-spawned headless session starts in its activation cwd `/private/tmp/clone`
- **THEN** the bridge SHALL log the reason code `forbidden-folder`

#### Scenario: Uncovered activation cwd is undecided and logged
- **WHEN** a dashboard-spawned headless session raises `project_trust` in its activation cwd, which is unpinned, in no workspace folder, covered by no grant or YOLO root, and `trust.json` has no entry for it
- **THEN** the bridge SHALL return undecided and log the reason code `not-covered`

#### Scenario: Unparseable trust store
- **WHEN** pi's trust store file is torn mid-write or holds a value other than true, false or null
- **THEN** the bridge SHALL return undecided

### Requirement: The Access page discloses pi trust conferred by the dashboard

Settings → Access SHALL show, for every mirrorable entry, whether it confers pi trust and a control for its choice, and SHALL list the effective dashboard trust — folder, source and subtree coverage — next to the entries recorded in pi's own trust store, naming the pi agent directory whose store it lists. The page SHALL show the `piTrustMirror` switches, SHALL state that dashboard trust takes precedence over pi's `defaultProjectTrust`, SHALL state that, unless `coverInteractive` is on in the config of the machine the session runs on, it applies to dashboard-spawned headless sessions only, that live entries end with their source, that server-side views (such as the folder MCP page) count live entries whatever the session kind while each pi session still applies `coverInteractive`, that bridges on other machines are trusted only when the content of pi's trust-requiring resources matches the server's, and SHALL state that sessions started with `--no-approve` or `--no-extensions`, and pi's own CLI commands, do not use it. Entries that do not count SHALL be shown with their reason code (`forbidden-folder`, `not-project-root`, `hook-changed`, `source-off`, `source-not-installed`, `identity-mismatch`, `choice-unreadable`, `not-covered`) and a readable label. The page SHALL list every bridge reason code (including `identity-weak`, `live-timeout`, `live-unreachable`, `live-refused`, `live-unsupported`, `live-rate-limited`, `live-not-covered`, `live-error`) with its label, so a code from a bridge log can be looked up.

#### Scenario: Ignored grant explains itself
- **WHEN** a persisted access grant on `/private/tmp` exists
- **THEN** the Access page SHALL show it as not conferring pi trust with the reason code `forbidden-folder`

#### Scenario: Effective list shows the source
- **WHEN** `/Users/me/Documents` is pinned
- **THEN** the effective list SHALL show `/Users/me/Documents`, source "pinned folder", covering subfolders

#### Scenario: Changed hook is explained
- **WHEN** the repo `/r` hook changed after it was trusted
- **THEN** the Access page SHALL show the `/r` entry as not conferring pi trust with the reason code `hook-changed` and the label "hook changed — re-approve"

#### Scenario: Not-covered code is listed with its label
- **WHEN** the Access page lists the bridge reason codes
- **THEN** it SHALL list `not-covered` with a readable label stating that no dashboard trust source covers the folder
