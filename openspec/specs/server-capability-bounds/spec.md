# server-capability-bounds Specification

## Purpose
Bound three authenticated-but-unconstrained server capabilities: concurrent PTY terminals (global and per-owner caps, orphaned inline reaping), directory browse and mkdir for remote (non-local) callers (confinement to the shared roots), and the unauthenticated recovery server's mutating actions (loopback bind, local-or-same-origin gate).

## Requirements

### Requirement: PTY sessions are bounded by a global cap
The terminal manager SHALL refuse a spawn, before starting any shell process, when
the number of live PTYs (ephemeral inline-terminal PTYs included) has reached
`terminals.maxConcurrent` (default 32). A non-integer or `< 1` configured value
SHALL fall back to the default.

#### Scenario: create_terminal refused at the global cap
- **WHEN** 32 PTYs are live and a client sends `create_terminal`
- **THEN** no shell process SHALL be spawned
- **AND** no `terminal_added` broadcast and no session-order insert SHALL occur
- **AND** the requesting socket SHALL receive `terminal_limit_reached` with `scope: "global"` and `limit: 32`

#### Scenario: inline terminal counts and is refused at the cap
- **WHEN** the global cap is reached and a client sends `open_inline_terminal`
- **THEN** no PTY SHALL be spawned and no `inline_terminal_open` event SHALL be written
- **AND** the requesting socket SHALL receive `terminal_limit_reached` with `inline: true`

#### Scenario: invalid configured cap falls back to default
- **WHEN** `terminals.maxConcurrent` is `0`, negative, or not an integer
- **THEN** the manager SHALL use 32

### Requirement: PTY sessions are bounded per owner
The terminal manager SHALL refuse a spawn when the requester's `{iss, sub}`
already owns `terminals.maxPerOwner` (default 16) live PTYs. Ownerless PTYs
(identity plane inert) SHALL count only toward the global cap.

#### Scenario: per-owner cap applies only to the owner's terminals
- **GIVEN** the identity plane is enforced and principal A owns 16 live PTYs
- **WHEN** A sends `create_terminal`
- **THEN** the spawn SHALL be refused with `scope: "owner"` and `limit: 16`
- **AND WHEN** principal B (owning fewer than 16) sends `create_terminal` while the global count is below 32
- **THEN** B's terminal SHALL spawn

#### Scenario: single-user install sees only the global cap
- **GIVEN** the identity plane is inert (terminals are ownerless)
- **WHEN** 20 PTYs are live and a client sends `create_terminal`
- **THEN** the terminal SHALL spawn

### Requirement: Tab terminals are not reaped on idleness
The terminal manager SHALL NOT end a non-ephemeral (tab) terminal for being idle
or detached; only shell exit or an explicit close SHALL end it.

#### Scenario: idle detached tab terminal is not reaped
- **WHEN** a tab terminal has no attached client and produces no output for 24 hours
- **THEN** its PTY SHALL still be live

### Requirement: Orphaned inline PTYs are reaped
The terminal manager SHALL kill an ephemeral (inline) PTY that has had no
attached client for `terminals.inlineOrphanTtlMs` (default 600000 ms), measured
from spawn or from the most recent last-client detach and paused while any client
is attached, through
the same kill path as an explicit close, so its transcript is retained like any
dead inline terminal.

#### Scenario: orphaned inline PTY reaped
- **WHEN** an inline PTY has had no attached client for 10 minutes
- **THEN** its PTY SHALL be killed and its transcript SHALL remain retrievable for its card

#### Scenario: never-attached inline PTY reaped from spawn
- **WHEN** an inline PTY is spawned and no client ever attaches within 10 minutes
- **THEN** its PTY SHALL be killed

#### Scenario: reattach resets the orphan clock
- **WHEN** an inline PTY's last client detaches at minute 0, a client reattaches at minute 9 and detaches at minute 9.5
- **THEN** the PTY SHALL still be live at minute 15 and SHALL be killed by minute 19.5 plus one sweep interval

#### Scenario: attached inline PTY kept
- **WHEN** an inline PTY has an attached client, even with no output for an hour
- **THEN** its PTY SHALL still be live

### Requirement: Remote browse requests are confined to shared roots
For `/api/browse`, `/api/browse/flags`, and `/api/browse/mkdir`, a request that
is not locally trusted (`isLocallyTrusted` false) SHALL be refused with HTTP 403
`path outside allowed roots` when its path, resolved through symlinks via its
nearest existing ancestor, lies outside every shared root. A locally trusted request SHALL NOT be confined.

#### Scenario: confined browse stays within its latency budget
- **GIVEN** 200 shared roots and a 200-entry directory under `$HOME`
- **WHEN** a non-local request lists that directory 100 times
- **THEN** the p95 response time SHALL be below 50 ms

#### Scenario: remote enumeration of filesystem root refused
- **WHEN** a non-local request calls `/api/browse?path=/`
- **THEN** the response SHALL be 403 with error `path outside allowed roots`

#### Scenario: remote browse via a symlink escaping a root refused
- **GIVEN** `$HOME/link` is a symlink to `/etc`
- **WHEN** a non-local request browses `$HOME/link`
- **THEN** the response SHALL be 403

#### Scenario: local browse is unconfined
- **WHEN** a locally trusted request calls `/api/browse?path=/`
- **THEN** the listing SHALL succeed and SHALL NOT carry `confined`

#### Scenario: operator opt-out disables confinement
- **GIVEN** `config.json` sets `browse.confineRemote` to `false` (default `true`; only an explicit `false` disables it; read at server start)
- **WHEN** a non-local request calls `/api/browse?path=/`, `/api/browse/flags` with an outside path, or `/api/browse/mkdir` with an outside parent
- **THEN** each SHALL behave as for a locally trusted request, and `pin_directory`, `add_folder_to_workspace` and `move_folder_to_workspace` from a non-local socket SHALL NOT be gated

### Requirement: Shared-root set
The shared-root set SHALL be `os.homedir()` plus every pinned directory, session
cwd, workspace folder, worktree-init trust root, and persisted project-scope
access-grant subject that is grantable (`isUngrantableSubject` false), recomputed
on every request. A path equal to or under `~/.ssh` or `~/.pi` SHALL be outside
the set. A root source that fails to read SHALL contribute no roots.

#### Scenario: remote browse inside a pinned directory outside $HOME succeeds
- **GIVEN** `/srv/work` is pinned
- **WHEN** a non-local request browses `/srv/work`
- **THEN** the listing SHALL succeed with `confined: true`

#### Scenario: newly pinned directory is browsable immediately
- **WHEN** a directory is pinned and a non-local request browses it on the next request
- **THEN** the listing SHALL succeed without a server restart

#### Scenario: pinned filesystem root is not a root
- **GIVEN** `/` is pinned
- **WHEN** a non-local request browses `/etc`
- **THEN** the response SHALL be 403

#### Scenario: sensitive home subtree refused
- **WHEN** a non-local request browses `$HOME/.ssh`
- **THEN** the response SHALL be 403

#### Scenario: symlink escaping a root is never offered in a listing
- **GIVEN** `$HOME/Dropbox` is a symlink to `/Volumes/ext/Dropbox`, which is outside every root
- **WHEN** a non-local request lists `$HOME`
- **THEN** the entries SHALL NOT include `Dropbox` (a directory listing never includes symlinked directories)

#### Scenario: non-existent path inside a root keeps its not-found error
- **WHEN** a non-local request browses `$HOME/does-not-exist`
- **THEN** the response SHALL be `{ success: false, error: "directory not found" }`, not 403

#### Scenario: access-grant subject is a root
- **GIVEN** a persisted access grant for `/data/shared`
- **WHEN** a non-local request browses `/data/shared/sub`
- **THEN** the listing SHALL succeed

### Requirement: Remote callers cannot widen the shared-root set
A `pin_directory`, `add_folder_to_workspace`, or `move_folder_to_workspace` from
a browser socket that was not locally trusted at upgrade SHALL be dropped, and
the socket SHALL receive a refusal, when the canonical path lies outside the
shared-root set. Locally trusted sockets
SHALL be unaffected.

#### Scenario: remote pin of filesystem root refused
- **WHEN** a non-local socket sends `pin_directory` with path `/`
- **THEN** nothing SHALL be pinned and the socket SHALL receive a refusal
- **AND** a following non-local `/api/browse?path=/` SHALL still be 403

#### Scenario: remote pin inside $HOME accepted
- **WHEN** a non-local socket sends `pin_directory` with path `$HOME/Project/app`
- **THEN** the directory SHALL be pinned

#### Scenario: remote add_folder_to_workspace outside roots refused
- **WHEN** a non-local socket sends `add_folder_to_workspace` with path `/opt/x`
- **THEN** the workspace SHALL be unchanged and the socket SHALL receive a refusal
- **AND** a following non-local `/api/browse?path=/opt/x` SHALL be 403

#### Scenario: remote move_folder_to_workspace outside roots refused
- **WHEN** a non-local socket sends `move_folder_to_workspace` with path `/opt/x` and `toWorkspaceId: null`
- **THEN** nothing SHALL be pinned or moved and the socket SHALL receive a refusal

#### Scenario: remote move of an existing root accepted
- **GIVEN** `$HOME/Project/app` is pinned
- **WHEN** a non-local socket moves it into a workspace
- **THEN** the move SHALL succeed

#### Scenario: local pin outside $HOME accepted
- **WHEN** a locally trusted socket sends `pin_directory` with path `/srv/work`
- **THEN** the directory SHALL be pinned

### Requirement: Recovery actions admit only a local caller
The recovery server SHALL admit `POST /api/recovery/retry` and
`POST /api/recovery/reinstall` only when the matching local IPC token is
presented in `x-pi-local-token`, or when the peer is loopback, no
proxy-forwarding header is present, and `Host` names a loopback host. Any other
request SHALL get HTTP 403 with remedy text and SHALL NOT spawn any process.

#### Scenario: tunnel-relayed reinstall refused
- **WHEN** a loopback-peer request with `x-forwarded-for` calls `POST /api/recovery/reinstall`
- **THEN** the response SHALL be 403 and no `npm install` SHALL run

#### Scenario: tunnel hostname refused even with matching Origin
- **WHEN** a loopback-peer request with `Host: abc.share.zrok.io` and `Origin: https://abc.share.zrok.io` calls `POST /api/recovery/retry`
- **THEN** the response SHALL be 403

#### Scenario: local token admits a non-loopback caller
- **WHEN** a request presents the matching `x-pi-local-token`
- **THEN** the action SHALL proceed

### Requirement: Recovery actions admit only a same-origin caller
A recovery action request carrying `Origin` SHALL be admitted only when the
Origin's host (scheme default port removed, lower-cased) equals the `Host`
header normalised the same way. `Origin: null` or an unparseable Origin SHALL be
refused. The recovery module's forwarding-header list SHALL equal the main
server's extended (plugin-scope) list, including `via`, `x-forwarded-server`,
and `x-forwarded-port`.

#### Scenario: cross-site POST from another local port refused
- **WHEN** a loopback request with `Host: localhost:8000` and `Origin: http://localhost:3000` calls `POST /api/recovery/retry`
- **THEN** the response SHALL be 403 and no respawn SHALL occur

#### Scenario: recovery page's own POST admitted
- **WHEN** a loopback request with `Host: localhost:8000` and `Origin: http://localhost:8000` calls `POST /api/recovery/retry`
- **THEN** the action SHALL proceed

#### Scenario: default port normalised
- **WHEN** a loopback request with `Host: localhost` and `Origin: http://localhost:80` calls `POST /api/recovery/retry`
- **THEN** the action SHALL proceed

#### Scenario: Via header refused
- **WHEN** a loopback-peer request carrying only `Via: 1.1 proxy` calls `POST /api/recovery/reinstall`
- **THEN** the response SHALL be 403

#### Scenario: opaque origin refused
- **WHEN** a loopback request carries `Origin: null`
- **THEN** the response SHALL be 403
