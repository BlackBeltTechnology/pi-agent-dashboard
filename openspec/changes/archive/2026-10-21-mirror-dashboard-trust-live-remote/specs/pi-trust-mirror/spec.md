# Spec Delta

## MODIFIED Requirements

### Requirement: Dashboard trust is derived from durable trust sources

The server SHALL derive dashboard trust from these durable sources: persisted worktree-init hook trust, persisted workflow trust, pinned folders (including the pins Docker seeds once from `PI_WORKSPACES` via `PI_DASHBOARD_PIN_DIRS`), folders added to folder-workspaces, and persisted access grants. Trust whose lifetime is bound to the running server (session-scoped worktree-init trust, session-scoped access grants, every YOLO session) SHALL NOT enter the snapshot and SHALL count only through the live trust query; KB source trust names content sources, not folders, and SHALL NOT count. A source whose producer is not installed SHALL be reported as such. A source entry SHALL count only when its source is enabled in `piTrustMirror.sources` and the entry's own choice is not `false`; an entry whose choice is `true` SHALL count even when its source default is disabled. A worktree-init or workflow entry SHALL count only while its recorded hook hash equals the hash of the hook definition currently in its configuration root, re-checked at every decision; an unreadable definition SHALL make it not count. An access grant SHALL count only while its subject is a project root (contains `.git` or `.pi`), re-checked at every decision. An entry whose stored choice cannot be read SHALL NOT count.

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
- **THEN** dashboard trust SHALL NOT cover `/r` through the snapshot, which SHALL NOT list `/r`; only the live trust query SHALL be able to cover it

#### Scenario: Access grant on a non-project folder does not count
- **WHEN** a persisted access grant's subject `/r/packages/client/src/components/preview` has neither `.git` nor `.pi`
- **THEN** dashboard trust SHALL NOT cover it through that grant

#### Scenario: YOLO does not count
- **WHEN** YOLO is active with root `/w`
- **THEN** dashboard trust SHALL NOT cover `/w` through the snapshot, which SHALL NOT list `/w`; only the live trust query SHALL be able to cover it

#### Scenario: Unreadable choice fails closed
- **WHEN** the per-entry choices file cannot be read and `/r` is pinned
- **THEN** dashboard trust SHALL NOT cover `/r` through that pin

### Requirement: Dashboard trust applies only to the same folder on the same machine

The bridge SHALL apply a covering snapshot entry only when the entry's canonical path equals the canonical path of the session cwd or one of its ancestors, and that folder's device and inode, as the bridge observes them at decision time, equal the values recorded in the entry; when the entry records a birth time (recorded only where the filesystem reported one distinct from the change time when the entry was written), the observed birth time SHALL equal it too. Any mismatch, or a folder the bridge cannot stat, SHALL make the entry not apply. A bridge on another machine SHALL get no dashboard trust from the snapshot; it SHALL get dashboard trust only through the live trust query, under the remote folder proof.

#### Scenario: Shared home directory on another machine
- **WHEN** a bridge on a second machine reads a snapshot through a network-shared home directory and its local `/work/x` differs in device or inode from the server's `/work/x`
- **THEN** that bridge SHALL NOT be trusted through the `/work/x` snapshot entry

#### Scenario: Re-created folder does not inherit trust
- **WHEN** a pinned folder is deleted and re-created at the same path
- **THEN** the entry SHALL NOT apply until the server records the new folder's identity

#### Scenario: Container with server and sessions inside
- **WHEN** the dashboard server and its sessions run in the same container and a workspace folder is pinned
- **THEN** a session in that folder SHALL be trusted through the pin

### Requirement: The bridge decides at project_trust from the snapshot

At pi's `project_trust` event the bridge SHALL read `piTrustMirror` from the dashboard config file, pi's trust store file without taking pi's lock, with pi's own reading rules (a leading byte-order mark stripped, `null` values treated as absent; any other read, parse or shape-validation failure yields undecided; an absent file means nothing recorded), and the server-written snapshot, without caching any of them across events, and SHALL return trusted for this run only (never remembered) when the folder decision yields dashboard trust, else undecided. It SHALL contact the server only through the live trust query and only under that query's conditions; when the snapshot covers the cwd it SHALL NOT contact the server. Only dashboard-spawned headless sessions SHALL consult dashboard trust unconditionally; every other session (interactive, or headless not spawned by the dashboard) SHALL consult it only when `piTrustMirror.coverInteractive` is true. Whether a session is dashboard-spawned SHALL be captured once at bridge activation from the single-use spawn token, which the bridge SHALL remove from its process environment at activation, so a pi process started later by the agent never qualifies. Every error SHALL yield undecided. An undecided outcome that withholds trust a dashboard-spawned session would otherwise have had SHALL be logged with one reason code from: `forbidden-folder`, `recorded-entry`, `identity-mismatch`, `identity-weak`, `hook-changed`, `not-project-root`, `source-off`, `source-not-installed`, `choice-unreadable`, `store-unreadable`, `not-covered-session`, `live-timeout`, `live-unreachable`, `live-refused`, `live-unsupported`, `live-rate-limited`, `live-not-covered`, `live-error`. With a snapshot of 1,000 entries and a cwd 20 levels deep, the snapshot part of the handler's decision SHALL complete with p95 below 20 ms. A bridge undecided only avoids a wrong yes: when pi's store is unreadable, pi's own startup may still fail on it.

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

#### Scenario: Unparseable trust store
- **WHEN** pi's trust store file is torn mid-write or holds a value other than true, false or null
- **THEN** the bridge SHALL return undecided

### Requirement: The snapshot holds only durable entries and stays fail-closed

Only the server holding the dashboard's home lock SHALL write the snapshot, atomically and readable only by its owner, rebuilt from the persisted source stores at boot and rewritten whenever a source, a per-entry choice or `piTrustMirror.sources` changes. It SHALL carry a generation counter and the counted durable entries, each with its canonical folder path, source kind, device, inode, birth time when reported, for worktree-init and workflow entries the configuration root and recorded hook hash. It SHALL also carry `liveCount`, the number of live entries currently counting, and no other information about them; it SHALL be rewritten whenever that number changes, before the action that changed it reports success (a failed rewrite is logged and does not fail that action), and written with `liveCount` 0 at boot. A reader SHALL treat a `liveCount` that is missing or not a non-negative integer as 0. When an entry is revoked, the snapshot SHALL be rewritten without it before the source store is written, both writes SHALL complete before the revocation reports success, and a failure of either SHALL be reported as a failed revocation. When an entry is granted, its source store and its choice SHALL be written before the snapshot; a failure of either SHALL fail the grant. A bridge SHALL ignore entries whose hook hash no longer matches. The snapshot has no entry cap; above 5,000 entries the server SHALL log a warning on each rewrite.

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

#### Scenario: Live entries appear only as a count
- **WHEN** YOLO is active with root `/w` and `/r` is trusted "until dashboard restarts"
- **THEN** the snapshot SHALL carry `liveCount` 2 and SHALL NOT contain `/w`, `/r` or any identity of them

#### Scenario: Live count resets at boot
- **WHEN** the server restarts after a crash while `liveCount` was 3
- **THEN** the rewritten snapshot SHALL carry `liveCount` 0

### Requirement: Trust mirror settings and per-entry choice

The dashboard config SHALL hold `piTrustMirror` with `enabled` (default true), `coverInteractive` (default false), `liveQuery` (default true), `liveQueryTimeoutMs` (milliseconds, default 300 for a local bridge and 1000 for a remote one, clamped to 50–1000, a non-finite value reads as the default) and `sources.<id>`, defaulting to true for worktree-init, workflow, pinned folders, folder-workspaces and YOLO, and to false for access grants. Every dialog that creates a mirrorable entry (worktree-init trust "Always trust" and "until dashboard restarts", workflow trust, pin folder, "Add Folder" into a workspace, access-grant prompt "always", a provisioning-dialog line whose folder is a project root, and a session-scoped access grant) SHALL show an "Also trust this folder in pi" checkbox pre-set from the source default, SHALL state that trusting lets every project extension and MCP server in the folder and below — including ones added later — start with pi, which is wider than approving one hook script, and SHALL store the operator's choice for that entry together with the entry (in memory only for a server-lifetime entry). Entries created before this change, or without a dialog (moving a folder between workspaces keeps its choice), follow the source default; the Access page SHALL mark them "by default". Every surface that activates YOLO SHALL state, while `sources.yolo` is true, that its roots are also trusted in pi until YOLO ends. Storing a choice SHALL NOT change the format existing readers of the source store rely on.

#### Scenario: Checkbox follows the source default
- **WHEN** `sources.worktreeInit` is true and the worktree-init trust dialog opens
- **THEN** "Also trust this folder in pi" SHALL be checked

#### Scenario: Access-grant prompt is unchecked by default
- **WHEN** an access-grant prompt opens with default settings
- **THEN** "Also trust this folder in pi" SHALL be unchecked

#### Scenario: Provisioning line is unchecked by default
- **WHEN** a provisioning dialog shows a grantable project-root line with default settings
- **THEN** "Also trust this folder in pi" SHALL be unchecked for that line, with the consequence statement shown

#### Scenario: Unchecking stores the choice
- **WHEN** the operator unchecks it and chooses "Always trust"
- **THEN** the choice `false` SHALL be stored for that entry and dashboard trust SHALL NOT cover the repo through it
- **AND** the worktree-init trust store SHALL still read the hook as trusted

#### Scenario: Session-scope choice stays in memory
- **WHEN** the operator unchecks it and chooses "until dashboard restarts"
- **THEN** the choice `false` SHALL be held in memory only, no file SHALL record it, and the live trust query SHALL NOT cover the repo through that entry

#### Scenario: A live entry and its choice end together
- **WHEN** the server restarts after a session-scope entry was created with the choice `false`
- **THEN** neither the entry nor its choice SHALL exist, and a new session-scope entry SHALL be created only through a dialog showing the checkbox again

#### Scenario: Out-of-range timeout is clamped
- **WHEN** `piTrustMirror.liveQueryTimeoutMs` is 5000
- **THEN** the effective timeout SHALL be 1000 ms

#### Scenario: YOLO activation discloses pi trust
- **WHEN** the operator opens a YOLO activation surface and `sources.yolo` is true
- **THEN** the surface SHALL state that the chosen roots are also trusted in pi until YOLO ends

### Requirement: One decision order serves every consumer

The folder decision SHALL be: a cwd with no trust-requiring project resources is implicitly trusted; otherwise pi's nearest recorded entry for the cwd or an ancestor (true or false), read from the trust store of the pi agent directory in use, decides; otherwise, when `piTrustMirror.enabled` is true, dashboard trust covering the cwd decides trusted — taking precedence over `defaultProjectTrust`, including `"never"`; otherwise `defaultProjectTrust` decides. Server-side consumers SHALL evaluate dashboard trust over the durable and the live entries, with no folder proof (they observe the server's own folders); a bridge SHALL evaluate it over the snapshot and the live trust query. The bridge's session gate (`coverInteractive`, activation-cwd rule) applies after this folder decision and only in the bridge; server-side consumers do not apply it. Every decision SHALL carry its source: the recorded pi entry path, "implicit", the dashboard source kind with its entry, or the default. Implicit trust SHALL be determined with pi's own function for trust-requiring resources, not a reimplementation. A session's command-line `--approve`/`--no-approve` is applied by pi before any of this, and `--no-extensions` keeps the bridge from deciding at all; both are outside the folder decision and SHALL be disclosed wherever dashboard trust is shown. Nothing in this decision SHALL write pi's trust store. The guarantee that a recorded pi entry wins holds at the moment the bridge reads the store and when no other extension answers `project_trust` before the bridge, because pi applies the first yes/no among extension handlers.

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

#### Scenario: Server consumer sees live trust
- **WHEN** nothing is recorded for `/r`, `/r` has `.pi/mcp.json`, and `/r` is trusted "until dashboard restarts" only
- **THEN** the server-side folder decision for `/r` SHALL be trusted with source "worktree-init (until dashboard restarts)"

### Requirement: The Access page discloses pi trust conferred by the dashboard

Settings → Access SHALL show, for every mirrorable entry, whether it confers pi trust and a control for its choice, and SHALL list the effective dashboard trust — folder, source and subtree coverage — next to the entries recorded in pi's own trust store, naming the pi agent directory whose store it lists. The page SHALL show the `piTrustMirror` switches, SHALL state that dashboard trust takes precedence over pi's `defaultProjectTrust`, SHALL state that, unless `coverInteractive` is on in the config of the machine the session runs on, it applies to dashboard-spawned headless sessions only, that live entries end with their source, that server-side views (such as the folder MCP page) count live entries whatever the session kind while each pi session still applies `coverInteractive`, that bridges on other machines are trusted only when the content of pi's trust-requiring resources matches the server's, and SHALL state that sessions started with `--no-approve` or `--no-extensions`, and pi's own CLI commands, do not use it. Entries that do not count SHALL be shown with their reason code (`forbidden-folder`, `not-project-root`, `hook-changed`, `source-off`, `source-not-installed`, `identity-mismatch`, `choice-unreadable`) and a readable label. The page SHALL list every bridge reason code (including `identity-weak`, `live-timeout`, `live-unreachable`, `live-refused`, `live-unsupported`, `live-rate-limited`, `live-not-covered`, `live-error`) with its label, so a code from a bridge log can be looked up.

#### Scenario: Ignored grant explains itself
- **WHEN** a persisted access grant on `/private/tmp` exists
- **THEN** the Access page SHALL show it as not conferring pi trust with the reason code `forbidden-folder`

#### Scenario: Effective list shows the source
- **WHEN** `/Users/me/Documents` is pinned
- **THEN** the effective list SHALL show `/Users/me/Documents`, source "pinned folder", covering subfolders

#### Scenario: Changed hook is explained
- **WHEN** the repo `/r` hook changed after it was trusted
- **THEN** the Access page SHALL show the `/r` entry as not conferring pi trust with the reason code `hook-changed` and the label "hook changed — re-approve"

## ADDED Requirements

### Requirement: Live trust sources count only while they live

The server SHALL count as live entries: session-scoped worktree-init trust (hook hash re-checked and key translated as for durable entries), session-scoped access grants on project roots, and each root of a live YOLO session — scoped until its expiry or end, environment-activated for the server process lifetime; unscoped YOLO never. Each SHALL record the folder's identity when created (none if unstatable: never counts) and pass the durable entries' switch, choice, subtree and deny rules.

#### Scenario: Scoped YOLO root counts until expiry
- **WHEN** YOLO is active with root `/w` expiring at 14:30 and `sources.yolo` is true
- **THEN** the live trust query SHALL cover `/w/app` before 14:30 and SHALL NOT cover it after 14:30

#### Scenario: Ended YOLO stops counting at once
- **WHEN** the operator ends a YOLO session with root `/w`
- **THEN** the next live trust query for `/w` SHALL NOT be covered through YOLO

#### Scenario: Unscoped YOLO never counts
- **WHEN** an unscoped YOLO session is active
- **THEN** the live trust query SHALL NOT cover any folder through YOLO

#### Scenario: Environment YOLO root counts while the server runs
- **WHEN** `PI_DASHBOARD_GRANT_YOLO` names `/w` and the server is running
- **THEN** the live trust query SHALL cover `/w` through YOLO

#### Scenario: YOLO source off
- **WHEN** YOLO is active with root `/w` and `sources.yolo` is false
- **THEN** the live trust query SHALL NOT cover `/w` through YOLO

#### Scenario: Forbidden YOLO root never counts
- **WHEN** a YOLO root is `~/Downloads/x`
- **THEN** the live trust query SHALL NOT cover it

#### Scenario: Session grant and session worktree trust update the live count
- **WHEN** a session-scoped access grant on a project root is created and later revoked
- **THEN** the snapshot `liveCount` SHALL rise by 1 and then fall by 1

### Requirement: The bridge issues a bounded live trust query

The bridge SHALL send one live trust query only when `enabled` and `liveQuery` are true in its config file, the session may consult dashboard trust, pi's store has no recorded entry, the cwd is not mirror-denied, the snapshot yields no cover for the cwd (for any reason), and `liveCount` is above 0 or the bridge is remote (a non-loopback dashboard endpoint used with a paired-device token). One deadline of `liveQueryTimeoutMs` SHALL bound the request and the proof check together.

#### Scenario: Live entry answers
- **WHEN** a dashboard-spawned headless session starts in `/r/wt`, `/r` is trusted "until dashboard restarts", and the snapshot has `liveCount` 1
- **THEN** the bridge SHALL issue a live trust query and SHALL decide trusted for that run when the answer covers `/r/wt` and its folder proof holds

#### Scenario: Snapshot entry fails identity, live entry covers
- **WHEN** a remote bridge's snapshot (read through a shared home) lists `/work/x` with a non-matching identity and the server covers `/work/x` through a live entry
- **THEN** the bridge SHALL issue a live trust query

#### Scenario: Live path switched off
- **WHEN** `piTrustMirror.liveQuery` is false and the snapshot `liveCount` is above 0
- **THEN** the bridge SHALL NOT issue a live trust query

### Requirement: The bridge maps every live-query outcome fail-closed

Only a covered answer whose folder proof holds, received while the bridge instance is still active, SHALL yield trusted. The bridge SHALL NOT follow redirects. Every other outcome SHALL yield undecided with one reason code: timeout or deadline `live-timeout`, no connection `live-unreachable`, 401/403 `live-refused`, 404 `live-unsupported`, 429 `live-rate-limited`, a not-covered answer `live-not-covered`, anything else `live-error`.

#### Scenario: Server too slow
- **WHEN** the server does not answer within `liveQueryTimeoutMs`
- **THEN** the bridge SHALL return undecided and log `live-timeout`

#### Scenario: Proof check runs out of time
- **WHEN** the answer arrives after 250 ms of a 300 ms deadline and computing the bridge-side proof would take 200 ms
- **THEN** the bridge SHALL stop at the deadline, return undecided and log `live-timeout`

#### Scenario: Server stopped
- **WHEN** the snapshot has `liveCount` 1 but the server is not running
- **THEN** the bridge SHALL return undecided within `liveQueryTimeoutMs` and log `live-unreachable`

#### Scenario: Server without the live query
- **WHEN** the server does not offer the live trust query
- **THEN** the bridge SHALL return undecided and log `live-unsupported`

#### Scenario: Server says not covered
- **WHEN** the live trust query answers not covered
- **THEN** the bridge SHALL return undecided and log `live-not-covered`

#### Scenario: Server error
- **WHEN** the live trust query answers with a server error or a malformed body
- **THEN** the bridge SHALL return undecided and log `live-error`

#### Scenario: Bridge replaced while waiting
- **WHEN** the bridge instance becomes inactive (reload) while its live trust query is pending and the answer is covered
- **THEN** the handler SHALL return undecided

### Requirement: The server answers a live trust query only to an authenticated requester

The server SHALL answer only a genuinely local requester (loopback, no forwarding headers, a fully verified endpoint-bound local-credential proof) or a paired device at the bridge-ticket tier; a login session or trusted network SHALL NOT suffice. Others are refused, disclosing nothing. It SHALL authenticate before reading any trust state.

#### Scenario: Unauthenticated request
- **WHEN** a request without a local-credential proof or device bearer reaches the live trust query
- **THEN** the server SHALL refuse it and disclose no trust information

#### Scenario: Relayed loopback is not local
- **WHEN** a request arrives on loopback with proxy-forwarding headers and no device bearer
- **THEN** the server SHALL refuse it

#### Scenario: Raw legacy local token is not enough
- **WHEN** a loopback query carries the raw local token instead of a verified proof
- **THEN** the server SHALL refuse it

#### Scenario: Browser login session is not enough
- **WHEN** a query carries only a browser login session cookie
- **THEN** the server SHALL refuse it

### Requirement: The server validates a live trust query before answering

After authentication and rate limiting the server SHALL reject a body over 8 KiB, and a cwd that is not absolute, has a NUL byte, exceeds 4,096 characters, or differs from the server's own canonical key for that path; it SHALL answer not covered when its own `enabled` or `liveQuery` is false or the cwd is mirror-denied.

#### Scenario: Oversized body
- **WHEN** a query body exceeds 8 KiB
- **THEN** the server SHALL reject it without reading trust state

#### Scenario: Malformed cwd
- **WHEN** the query names the relative path `work/x`
- **THEN** the server SHALL reject it as malformed

#### Scenario: Non-canonical cwd
- **WHEN** the query names `/w/link/app` and on the server `/w/link` is a symlink to `/w/real`
- **THEN** the server SHALL answer not covered

#### Scenario: Server-side switch wins
- **WHEN** the bridge's config file says `enabled` true but the server's effective config says `enabled` false
- **THEN** the server SHALL answer not covered

### Requirement: Live answers to a local requester carry the recorded folder identity

For a genuinely local requester a covered answer SHALL name the covering folder and carry the device, inode and birth time recorded when the live entry was created (durable entries: as recorded for the snapshot). The bridge SHALL compare them with its own stat as for snapshot entries; a mismatch or unstatable folder SHALL yield undecided with `identity-mismatch`.

#### Scenario: Local proof holds
- **WHEN** a genuinely local bridge receives a covered answer for `/r` and its own stat of `/r` matches the recorded device, inode and birth time
- **THEN** the bridge SHALL decide trusted for that run

#### Scenario: Re-created folder does not inherit live trust
- **WHEN** `/r` was trusted "until dashboard restarts", then deleted and re-created at the same path
- **THEN** the bridge SHALL return undecided with `identity-mismatch`


#### Scenario: Re-created YOLO root does not inherit live trust
- **WHEN** YOLO root `/w` is deleted and re-created while the YOLO session is live
- **THEN** the bridge SHALL return undecided with `identity-mismatch`
### Requirement: Remote bridges get trust only when pi's trust-requiring resources match

For a paired-device requester a covered answer SHALL carry a fresh salt and a salted digest, bound to the cwd key, of the content of every resource pi's trust gate protects for that cwd (`.pi` configuration resources, ancestor `.agents/skills` except the user's own). The bridge SHALL recompute it and trust only on equality of two computed digests. An empty set, a symlink, code referenced from outside the set, or over 1,000 files / 16 MiB fails closed: `identity-weak`.

#### Scenario: NFS-shared folder at the same path
- **WHEN** a remote bridge's `/work/x` is the server's `/work/x` shared over NFS, `/work/x` is covered, and its trust-requiring resources are byte-identical on both sides
- **THEN** the bridge SHALL decide trusted for that run

#### Scenario: Same top level, different MCP config
- **WHEN** a remote bridge's `/work/x` is an mtime-preserving copy of the server's covered `/work/x` except for `.pi/mcp.json`
- **THEN** the digests SHALL differ and the bridge SHALL return undecided with `identity-mismatch`

#### Scenario: Resource set too large
- **WHEN** the cwd's trust-requiring resources hold 1,500 files
- **THEN** the bridge SHALL return undecided with `identity-weak`

#### Scenario: Symlinked extensions fail closed
- **WHEN** the cwd's `.pi/extensions` contains a symlink
- **THEN** the bridge SHALL return undecided with `identity-weak`

#### Scenario: Settings reference a package
- **WHEN** the cwd's `.pi/settings.json` lists an npm package or an extension path outside the hashed set
- **THEN** the bridge SHALL return undecided with `identity-weak`

#### Scenario: Digest of a typical tree stays within budget
- **WHEN** the cwd's trust-requiring resources hold 200 files totalling 2 MiB on local disk
- **THEN** computing the digest SHALL take p95 below 200 ms on each side

#### Scenario: Salt is fresh per answer
- **WHEN** the same remote bridge queries the same covered folder twice
- **THEN** the two answers SHALL carry different salts

#### Scenario: Remote answer omits the source
- **WHEN** a paired device receives a covered answer
- **THEN** the answer SHALL NOT name the source kind or the covering folder's recorded identity

### Requirement: Live trust queries are rate-limited and observable

The server SHALL allow each paired device 20 and the local user 200 live trust queries per 10 seconds, and at most 4 proof computations at once (1 per device), refusing excess as rate-limited, logged once per window. `/api/health` SHALL count covered, not covered, refused, rate-limited and budget-missed (handling over its effective `liveQueryTimeoutMs`) queries.

#### Scenario: Burst from one device
- **WHEN** one paired device sends 25 queries within 10 seconds
- **THEN** 5 SHALL be refused as rate-limited, one log line SHALL record it, and the bridge SHALL log `live-rate-limited`

#### Scenario: Fleet spawn from one machine
- **WHEN** the dashboard spawns 30 headless sessions at once on its own machine, each issuing one live trust query
- **THEN** none SHALL be refused as rate-limited

#### Scenario: Slow handling is counted
- **WHEN** `liveQueryTimeoutMs` is 300 and handling a query takes 450 ms on the server
- **THEN** the budget-missed counter SHALL increase by 1

### Requirement: The Access page discloses live pi trust

Settings → Access SHALL list live entries in the effective dashboard trust with their source and lifetime ("until dashboard restarts", "YOLO until <time>", "YOLO while the server runs"), and SHALL show the `liveQuery` and `liveQueryTimeoutMs` settings.

#### Scenario: YOLO root is listed with its end
- **WHEN** YOLO is active with root `/w` until 14:30
- **THEN** the effective list SHALL show `/w`, source "YOLO", lifetime "YOLO until 14:30"

#### Scenario: Session worktree trust is listed
- **WHEN** `/r` is trusted "until dashboard restarts"
- **THEN** the effective list SHALL show `/r`, source "worktree-init", lifetime "until dashboard restarts"
