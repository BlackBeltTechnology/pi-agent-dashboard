## Purpose

Lets the folders the dashboard durably trusts count as trusted projects for pi sessions on the same machine, decided at pi's `project_trust` time without writing pi's trust store, and discloses which source trusts each folder.

## ADDED Requirements

### Requirement: Dashboard trust is derived from durable trust sources

The server SHALL derive dashboard trust from these durable sources: persisted worktree-init hook trust, persisted workflow trust, pinned folders (including the pins Docker seeds once from `PI_WORKSPACES` via `PI_DASHBOARD_PIN_DIRS`), folders added to folder-workspaces, and persisted access grants. Trust whose lifetime is bound to the running server (session-scoped worktree-init trust, session-scoped access grants, every YOLO session) SHALL NOT count; KB source trust names content sources, not folders, and SHALL NOT count. A source whose producer is not installed SHALL be reported as such. A source entry SHALL count only when its source is enabled in `piTrustMirror.sources` and the entry's own choice is not `false`; an entry whose choice is `true` SHALL count even when its source default is disabled. A worktree-init or workflow entry SHALL count only while its recorded hook hash equals the hash of the hook definition currently in its configuration root, re-checked at every decision; an unreadable definition SHALL make it not count. An access grant SHALL count only while its subject is a project root (contains `.git` or `.pi`), re-checked at every decision. An entry whose stored choice cannot be read SHALL NOT count.

#### Scenario: Pinned folder counts
- **WHEN** `/Users/me/Documents` is pinned and `piTrustMirror.sources.pinned` is true
- **THEN** dashboard trust SHALL cover `/Users/me/Documents`

#### Scenario: Per-entry choice disables one entry
- **WHEN** `/Users/me/Documents` is pinned with the choice `false`
- **THEN** dashboard trust SHALL NOT cover it through that pin

#### Scenario: Per-entry choice enables one entry of a disabled source
- **WHEN** `piTrustMirror.sources.accessGrants` is false and one persisted access grant on a project root has the choice `true`
- **THEN** dashboard trust SHALL cover that grant's subject

#### Scenario: Edited hook stops counting
- **WHEN** the repo `/r` has a persisted worktree-init trust entry only for a hook hash that differs from its current hook
- **THEN** dashboard trust SHALL NOT cover `/r` through it until the current hook is trusted again

#### Scenario: Session-scoped trust does not count
- **WHEN** `/r` is trusted "until dashboard restarts" only
- **THEN** dashboard trust SHALL NOT cover `/r`

#### Scenario: Access grant on a non-project folder does not count
- **WHEN** a persisted access grant's subject `/r/packages/client/src/components/preview` has neither `.git` nor `.pi`
- **THEN** dashboard trust SHALL NOT cover it through that grant

#### Scenario: YOLO does not count
- **WHEN** YOLO is active with root `/w`
- **THEN** dashboard trust SHALL NOT cover `/w` through YOLO

#### Scenario: Unreadable choice fails closed
- **WHEN** the per-entry choices file cannot be read and `/r` is pinned
- **THEN** dashboard trust SHALL NOT cover `/r` through that pin

### Requirement: Dashboard trust covers subtrees and never covers forbidden folders

A counted entry SHALL cover its folder and every folder below it. Paths SHALL be compared in pi's trust-store key form (`canonicalizePath(resolvePath(path))` without Unicode-space normalisation) through one shared key function that rejects relative input and takes the home directory explicitly; stores keeping another key form (the worktree-init store keeps `path.resolve`) SHALL be translated on read, and a key that cannot be matched SHALL fail closed. These mirror rules SHALL be separate from the dashboard's grant-subject rules, which this change SHALL NOT alter. An entry SHALL NOT count when its folder is exactly a folder the dashboard refuses as a whole grant subject (the filesystem root, the home directory, the platform system directories), an ancestor of the home directory, or exactly a platform broad parent (POSIX: `/Users`, `/home`, `/Volumes`, `/private`, `/var/tmp`, `/mnt`, `/media`; Windows: a drive root, `C:\Users`). Dashboard trust SHALL NOT cover any folder at or below `~/.ssh`, `~/.pi`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker`, the OS temporary directories (`os.tmpdir()`, `/tmp`, `/private/tmp`), `~/.cache` or `~/Downloads`, compared after canonicalisation. The key function SHALL be verified against the installed pi's trust-store key by shared golden cases (tilde, symlinked, missing, case-variant on case-insensitive filesystems, non-breaking-space inputs — the last asserting no normalisation).

#### Scenario: Subfolder is covered
- **WHEN** `/Users/me/Documents` is covered
- **THEN** `/Users/me/Documents/Projektek/x` SHALL be covered

#### Scenario: Symlinked path is matched canonically
- **WHEN** `/work-link` is a symlink to `/Users/me/work` and `/Users/me/work` is covered
- **THEN** a session in `/work-link/app` SHALL be covered

#### Scenario: Temporary directory entry is ignored
- **WHEN** a persisted access grant names `/private/tmp` with the choice `true`
- **THEN** neither `/private/tmp` nor `/private/tmp/clone` SHALL be covered

#### Scenario: Forbidden folder pin is ignored
- **WHEN** the home directory, `/Users`, or `~/.ssh` is pinned
- **THEN** dashboard trust SHALL NOT cover it through that pin

### Requirement: One decision order serves every consumer

The folder decision SHALL be: a cwd with no trust-requiring project resources is implicitly trusted; otherwise pi's nearest recorded entry for the cwd or an ancestor (true or false), read from the trust store of the pi agent directory in use, decides; otherwise, when `piTrustMirror.enabled` is true, dashboard trust covering the cwd decides trusted — taking precedence over `defaultProjectTrust`, including `"never"`; otherwise `defaultProjectTrust` decides. Every decision SHALL carry its source: the recorded pi entry path, "implicit", the dashboard source kind with its entry, or the default. Implicit trust SHALL be determined with pi's own function for trust-requiring resources, not a reimplementation. A session's command-line `--approve`/`--no-approve` is applied by pi before any of this, and `--no-extensions` keeps the bridge from deciding at all; both are outside the folder decision and SHALL be disclosed wherever dashboard trust is shown. Nothing in this decision SHALL write pi's trust store. The guarantee that a recorded pi entry wins holds at the moment the bridge reads the store and when no other extension answers `project_trust` before the bridge, because pi applies the first yes/no among extension handlers.

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
- **THEN** the folder decision SHALL equal pi's own resolution, and the bridge SHALL keep only its activation-cwd per-run rule (including that rule's recorded-entry and forbidden-folder conditions, which the switch does not revert)

#### Scenario: Deciding never writes trust.json
- **WHEN** any session resolves trust through dashboard trust
- **THEN** `~/.pi/agent/trust.json` SHALL be unchanged by that resolution

### Requirement: Dashboard trust applies only to the same folder on the same machine

The bridge SHALL apply a covering entry only when the entry's canonical path equals the canonical path of the session cwd or one of its ancestors, and that folder's device and inode, as the bridge observes them at decision time, equal the values recorded in the entry; when the entry records a birth time (recorded only where the filesystem reported one distinct from the change time when the entry was written), the observed birth time SHALL equal it too. Any mismatch, or a folder the bridge cannot stat, SHALL make the entry not apply. Bridges on other machines are out of scope of this capability and SHALL get no dashboard trust.

#### Scenario: Shared home directory on another machine
- **WHEN** a bridge on a second machine reads a snapshot through a network-shared home directory and its local `/work/x` differs in device or inode from the server's `/work/x`
- **THEN** that bridge SHALL NOT be trusted through the `/work/x` entry

#### Scenario: Re-created folder does not inherit trust
- **WHEN** a pinned folder is deleted and re-created at the same path
- **THEN** the entry SHALL NOT apply until the server records the new folder's identity

#### Scenario: Container with server and sessions inside
- **WHEN** the dashboard server and its sessions run in the same container and a workspace folder is pinned
- **THEN** a session in that folder SHALL be trusted through the pin

### Requirement: The bridge decides at project_trust from the snapshot

At pi's `project_trust` event the bridge SHALL read `piTrustMirror` from the dashboard config file, pi's trust store file without taking pi's lock, with pi's own reading rules (a leading byte-order mark stripped, `null` values treated as absent; any other read, parse or shape-validation failure yields undecided; an absent file means nothing recorded), and the server-written snapshot, without caching any of them across events, and SHALL return trusted for this run only (never remembered) when the folder decision yields dashboard trust, else undecided. It SHALL NOT contact the server. Only dashboard-spawned headless sessions SHALL consult dashboard trust unconditionally; every other session (interactive, or headless not spawned by the dashboard) SHALL consult it only when `piTrustMirror.coverInteractive` is true. Whether a session is dashboard-spawned SHALL be captured once at bridge activation from the single-use spawn token, which the bridge SHALL remove from its process environment at activation, so a pi process started later by the agent never qualifies. Every error SHALL yield undecided. An undecided outcome that withholds trust a dashboard-spawned session would otherwise have had SHALL be logged with one reason code from: `forbidden-folder`, `recorded-entry`, `identity-mismatch`, `hook-changed`, `not-project-root`, `source-off`, `source-not-installed`, `choice-unreadable`, `store-unreadable`, `not-covered-session`. With a snapshot of 1,000 entries and a cwd 20 levels deep, the handler's decision SHALL complete with p95 below 20 ms. A bridge undecided only avoids a wrong yes: when pi's store is unreadable, pi's own startup may still fail on it.

#### Scenario: Snapshot answers without the server
- **WHEN** the server is stopped and a dashboard-spawned headless session starts in a pinned folder recorded in the snapshot
- **THEN** the session SHALL be trusted for that run

#### Scenario: Uncovered folder
- **WHEN** a session starts in a folder no snapshot entry covers
- **THEN** the bridge SHALL return undecided and pi's own resolution SHALL apply

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

#### Scenario: Unparseable trust store
- **WHEN** pi's trust store file is torn mid-write or holds a value other than true, false or null
- **THEN** the bridge SHALL return undecided

### Requirement: The snapshot holds only durable entries and stays fail-closed

Only the server holding the dashboard's home lock SHALL write the snapshot, atomically and readable only by its owner, rebuilt from the persisted source stores at boot and rewritten whenever a source, a per-entry choice or `piTrustMirror.sources` changes. It SHALL carry a generation counter and the counted durable entries, each with its canonical folder path, source kind, device, inode, birth time when reported, for worktree-init and workflow entries the configuration root and recorded hook hash. When an entry is revoked, the snapshot SHALL be rewritten without it before the source store is written, both writes SHALL complete before the revocation reports success, and a failure of either SHALL be reported as a failed revocation. When an entry is granted, its source store and its choice SHALL be written before the snapshot; a failure of either SHALL fail the grant. A bridge SHALL ignore entries whose hook hash no longer matches. The snapshot has no entry cap; above 5,000 entries the server SHALL log a warning on each rewrite.

#### Scenario: Revocation removes the entry
- **WHEN** a pinned folder is unpinned
- **THEN** the snapshot SHALL no longer list it and the next pi session there SHALL not be trusted through it

#### Scenario: Failed snapshot write blocks the revocation
- **WHEN** unpinning a folder and the snapshot cannot be written
- **THEN** the unpin SHALL fail with an error and the folder SHALL stay pinned

#### Scenario: Disabling while the server is down
- **WHEN** the server is stopped and the operator sets `piTrustMirror.enabled` to false in the dashboard config file
- **THEN** a bridge SHALL NOT apply dashboard trust

#### Scenario: Hook edited while the server is down
- **WHEN** the server is stopped and the worktree-init hook of a trusted repo is edited
- **THEN** a bridge SHALL NOT trust that repo from the snapshot

### Requirement: Trust mirror settings and per-entry choice

The dashboard config SHALL hold `piTrustMirror` with `enabled` (default true), `coverInteractive` (default false) and `sources.<id>`, defaulting to true for worktree-init, workflow, pinned folders and folder-workspaces, and to false for access grants. Every dialog that creates a mirrorable entry (worktree-init trust "Always trust", workflow trust, pin folder, "Add Folder" into a workspace, access-grant prompt "always") SHALL show an "Also trust this folder in pi" checkbox pre-set from the source default, SHALL state that trusting lets every project extension and MCP server in the folder and below — including ones added later — start with pi, which is wider than approving one hook script, and SHALL store the operator's choice for that entry together with the entry. Entries created before this change, or without a dialog (moving a folder between workspaces keeps its choice), follow the source default; the Access page SHALL mark them "by default". Storing a choice SHALL NOT change the format existing readers of the source store rely on.

#### Scenario: Checkbox follows the source default
- **WHEN** `sources.worktreeInit` is true and the worktree-init trust dialog opens
- **THEN** "Also trust this folder in pi" SHALL be checked

#### Scenario: Access-grant prompt is unchecked by default
- **WHEN** an access-grant prompt opens with default settings
- **THEN** "Also trust this folder in pi" SHALL be unchecked

#### Scenario: Unchecking stores the choice
- **WHEN** the operator unchecks it and chooses "Always trust"
- **THEN** the choice `false` SHALL be stored for that entry and dashboard trust SHALL NOT cover the repo through it
- **AND** the worktree-init trust store SHALL still read the hook as trusted

### Requirement: The Access page discloses pi trust conferred by the dashboard

Settings → Access SHALL show, for every mirrorable entry, whether it confers pi trust and a control for its choice, and SHALL list the effective dashboard trust — folder, source and subtree coverage — next to the entries recorded in pi's own trust store, naming the pi agent directory whose store it lists. The page SHALL show the `piTrustMirror` switches, SHALL state that dashboard trust takes precedence over pi's `defaultProjectTrust`, SHALL state that, unless `coverInteractive` is on, it applies to dashboard-spawned headless sessions only, and SHALL state that sessions started with `--no-approve` or `--no-extensions`, and pi's own CLI commands, do not use it. Entries that do not count SHALL be shown with their reason code (`forbidden-folder`, `not-project-root`, `hook-changed`, `source-off`, `source-not-installed`, `identity-mismatch`, `choice-unreadable`) and a readable label.

#### Scenario: Ignored grant explains itself
- **WHEN** a persisted access grant on `/private/tmp` exists
- **THEN** the Access page SHALL show it as not conferring pi trust with the reason code `forbidden-folder`

#### Scenario: Effective list shows the source
- **WHEN** `/Users/me/Documents` is pinned
- **THEN** the effective list SHALL show `/Users/me/Documents`, source "pinned folder", covering subfolders

#### Scenario: Changed hook is explained
- **WHEN** the repo `/r` hook changed after it was trusted
- **THEN** the Access page SHALL show the `/r` entry as not conferring pi trust with the reason code `hook-changed` and the label "hook changed — re-approve"
