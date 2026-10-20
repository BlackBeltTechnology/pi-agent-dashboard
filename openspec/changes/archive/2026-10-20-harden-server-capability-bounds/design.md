# Design - harden-server-capability-bounds

## Context

`security-boundary-audit` found three authenticated-but-unbounded server capabilities (B7 PTY spawn, B8 browse/mkdir, B9 recovery actions). A first implementation pass landed on `develop` as WIP commit `1d546c995` and was handed back to planning (`SHIP_IT_BLOCKED.md` in the worktree) because it ran without `design.md` / `test-plan.md` and its UX review found work outside the spec. This design records the decisions taken in planning; several **reverse** parts of the WIP. The worktree reworks the WIP to match.

Current code (develop, WIP included):

- PTY spawn: `TerminalManager.spawn(cwd, {ephemeral?, owner?})` - `packages/server/src/terminal/terminal-manager.ts:300`. WIP adds a global + per-cwd cap that throws `TerminalLimitError` (`:302`, `:305`) and a 6 h idle reaper (`DEFAULT_IDLE_REAP_MS`, `:87`).
- Spawn call sites: `handleCreateTerminal` / `handleOpenInlineTerminal` - `packages/server/src/browser-handlers/terminal-handler.ts:46`, `:66`; dispatched from `packages/server/src/pairing/browser-gateway.ts:2416`. No try/catch: a thrown cap error reaches the gateway's handler-exception logger only; the browser sees nothing.
- Owner stamping: `ownerForSpawn(ctx)` returns the principal only while the identity resolver is active, else `undefined` - `terminal-handler.ts:15`.
- Browse routes: `/api/browse`, `/api/browse/flags`, `/api/browse/mkdir` in `packages/server/src/routes/file-routes.ts:507`, `:542`, `:564`. WIP confines ALL callers to `$HOME` + pinned via `lib/browse-roots.ts` (`resolveBrowseRoots`, `isWithinBrowseRoots`, `BROWSE_OUTSIDE_ROOTS_ERROR`) - `file-routes.ts:498`.
- Route tiers: browse/flags `observe`, mkdir/create-project `control` - `packages/shared/src/route-tiers.ts:103`, `:104`, `:294`, `:295`.
- Local-origin predicate: `isLocallyTrusted({ip, headers}, ctx?)` = loopback peer AND no proxy-forwarding header (+ local proof when strict) - `packages/server/src/auth/localhost-guard.ts:93`; `isGenuinelyLocal` `:82`. Server builds `localTrust` at `packages/server/src/server.ts:714`.
- Root sources already enumerated for the pi-trust mirror: pinned, workspace folders, worktree-init trust, persisted grants - `packages/server/src/server.ts:1552`-`:1555`, consumed by `buildCandidates` in `packages/server/src/access/pi-trust-mirror-service.ts:152`. Session cwds: `sessionManager.listAll()` (used in `file-routes.ts:1027`). Docker `PI_WORKSPACES` mounts are auto-pinned via `PI_DASHBOARD_PIN_DIRS` - `docker/up.sh:9`.
- Grant check: `isGrantAdmitted(resolved, subjects)` strict realpath, subject compared verbatim - `packages/server/src/lib/path-containment.ts:130`.
- Recovery server: `startRecoveryServer(info)` - `packages/server/src/lifecycle/recovery-server.ts`. WIP binds `info.host ?? "127.0.0.1"` (`:491`) and gates POSTs with `isRecoveryActionAllowed` (`:71`: local token, or loopback peer + loopback `Host` + loopback-hostname `Origin`). Caller passes `host: config.host`, `localToken: readLocalTokenIfPresent()` - `packages/server/src/cli.ts:271`-`:277`. Default `bindHost` is `127.0.0.1` - `packages/shared/src/config.ts:1631`.
- Spec `server-startup-recovery` mandates node-built-in-only imports for the recovery module.

## Threat model (what B8 confinement actually buys)

`/api/browse` + `/flags` are `observe` tier; `mkdir`, pin, workspace edits, session spawn and `create_terminal` are `control`/`operate` tier (`packages/shared/src/route-tiers.ts`, `identity/ws-message-tiers`). A remote caller that may spawn a session or a terminal already has filesystem reach through that shell/agent, so confinement is not a barrier against it. B8 confinement protects against the **observe-tier remote viewer** (and against casual over-reach by a paired device): it must not enumerate or create outside the shared roots. Consequences:

- Session cwds stay a root source (decision 2). A remote caller able to spawn a session at `/etc` could widen the browse roots, but that caller could already read `/etc` through the session - not an escalation. Recorded, not closed here.
- D1b (remote pin/workspace gate) is consistency + least surprise ("ask the host to pin it" stays true), not a hard boundary.
- `$HOME` listing remotely (minus `~/.ssh`, `~/.pi`) is accepted by decision 2: directory names, not file contents.

## Goals / Non-goals

Goals: bound PTY count (and keep hidden inline PTYs from holding the cap); stop remote filesystem enumeration/write outside shared folders; stop remote and cross-site recovery actions; make every refusal visible to the user (mockup A, B, C).

Non-goals: terminal `cwd` validation (audit R1, owned by `close-residual-audit-findings`); a remote "request access" flow; changing `/api/browse/create-project` (already confined to `<home>/Projects`, `browse.ts` `createProjectDirectory`); confining the local picker.

## Decisions

### D1 - Browse confinement applies only to non-local requests

A request is confined iff `!isLocallyTrusted({ip: request.ip, headers: request.headers}, localTrust)`. Genuinely-local callers (same desktop browser, Electron shell) keep today's unrestricted picker, including `..` up to `/`, other drives, `/Volumes`.

- Why: B8's risk is the tunnel/LAN/paired-device path; local users browsing `D:\` or external volumes is legitimate and confining it is a regression with no security gain (a local user already has a shell).
- Rejected: confine everyone (WIP behaviour) - breaks Windows multi-drive, external volumes; generous roots for everyone - near-zero confinement.
- Consequence: the WIP `browseRoots` gate moves behind the local check; `localTrust` is threaded into `registerFileRoutes` deps.
- Residual (same as D4): `requireLocalProof` defaults off (`packages/shared/src/config.ts:1675`), so a marker-less relay (`ssh -R`, no forwarding headers) presenting as loopback is treated as local and gets the unconfined picker. Operators who expose such a relay turn on strict local proof. Not claimed closed.
- Docker: `docker/compose.yml` binds `0.0.0.0`; a host browser reaches the container through the port mapping, so its peer is the bridge gateway, not loopback -> it is confined (to the container `$HOME` + auto-pinned `PI_WORKSPACES`, which is everything useful inside the container). Accepted and documented.
- **Operator opt-out (added in apply, user-approved).** `config.json` `browse.confineRemote` (default `true`; only an explicit `false` disables; read at server start, restart to apply). Why: the Docker e2e harness browser is a remote peer through the port mapping, and ~30 specs pin per-test directories outside `$HOME` via the picker; those directories cannot be pre-pinned. The harness seeds `false` unless `PI_E2E_BROWSE_CONFINEMENT=1` (variant boot for `tests/e2e/remote-browse-confinement.spec.ts`). `false` makes browse routes and the D1b gate behave as for a local caller (`browseRoots()` resolves `null`). Not a security default: shipping installs stay confined.

### D1b - Remote callers cannot widen their own roots

`pin_directory` (`browser-handlers/directory-handler.ts:25`), `add_folder_to_workspace` (`handleAddFolderToWorkspace`, `directory-handler.ts:349`; message `{id, path, piTrust?}`, `packages/shared/src/browser-protocol.ts:1913`) and `move_folder_to_workspace` (`handleMoveFolderToWorkspace`, `directory-handler.ts:412`; message `{path, toWorkspaceId, index?}`, `browser-protocol.ts:1945`; `toWorkspaceId: null` also pins) feed the root set (D2); they are dispatched from `pairing/browser-gateway.ts:2221`, `:2275`, `:2287`. `create_workspace` takes only `{name}` (`browser-protocol.ts:1805`) and adds no folder - not gated. A non-local socket SHALL only pin / add / move a folder whose canonical path already lies inside the shared-root set (a folder that is already a root therefore stays movable); otherwise the command is dropped and the socket receives a refusal (`folder_refused {path, reason: "outside_allowed_roots"}` toast, mirroring B2 copy "Ask the host to pin it"). Locally trusted sockets are unchanged.

- Default-deny: only an explicit `locallyTrusted === true` socket is local; an unflagged context is gated like a remote one (review round 1, B1).
- Ordering: the root check is async, so a gated remote command completes after a following ungated command from the same socket (e.g. `reorder_workspace_folders` right after a remote `move_folder_to_workspace`). Accepted: remote-only, cosmetic; local sockets stay synchronous.
- Needs a per-socket locality bit: computed once at the `/ws` upgrade with `isLocallyTrusted` over the upgrade request and stamped on the socket (like `principal`), read by the handlers via `ctx`.
- Session spawn at an arbitrary cwd is audit R1 (`close-residual-audit-findings`) - not this change. Session cwds are still a root source; R1 closes that widening path.
- Rejected: provenance-tagged roots (needs a store migration); filter-only (still lets remote pin `/opt/secret`).

### D2 - Remote allowed-root set = every place the dashboard already "shares"

Roots (union, realpath'd, deduped, recomputed per request so pin/unpin/grant applies immediately):

1. `os.homedir()` - minus the forbidden subtrees below
2. pinned directories (`preferencesStore.getPinnedDirectories()`) - covers Docker `PI_WORKSPACES` via first-run pin seeding
3. session cwds (`sessionManager.listAll().map(s => s.cwd)`)
4. workspace folders (`preferencesStore.getWorkspaces().flatMap(w => w.folders)`)
5. worktree-init trust roots (`listPersistedTrust()` from `git-worktree/worktree-init-trust.ts`, imported as `listPersistedWorktreeTrust` in `server.ts:168`; `repoRoot` of each)
6. persisted **project-scope** access-grant subjects (`listGrants()` from `access/access-grants.ts`, imported as `listAccessGrants` in `server.ts:57`; same `scope === "project"` filter the pi-trust mirror uses at `server.ts:1555`; session-scope grants are transient and excluded)

Forbidden filter (reuse `packages/shared/src/forbidden-subjects.ts`, do not re-list):

- Every candidate root from sources 2-6 for which `isUngrantableSubject` (`forbidden-subjects.ts:182`) is true is dropped: `/`, `$HOME` itself, platform system roots, and any ancestor of those or of a sensitive dir (`/Users`, `/private`). A remote pin of `/` therefore never becomes a root (and D1b refuses it anyway).
- `$HOME` (source 1) is the one explicit exception: it is added directly, not through the filter.
- A request path equal to or under a `forbiddenGrantSubjects().sensitive` entry (`~/.ssh`, `~/.pi`; `forbidden-subjects.ts:113`) is refused even though `$HOME` is a root.

This keeps browse consistent with `path-anchor-grants` (forbidden subjects). The pi-trust-mirror's wider never-cover list (`~/.aws`, `~/Downloads`, ...) is a trust-mirroring policy, not a browse secret list; listing those directories remotely is not reading them - accepted.

- One helper `resolveBrowseRoots(sources)` in `lib/browse-roots.ts` takes the source lists (testable without stores); `file-routes.ts` supplies them.
- Containment: request side resolved with `safeRealpath` (real path of the nearest existing ancestor + the lexical non-existent tail; `lib/path-containment.ts:64`), roots realpath'd once per request; a symlink inside a root pointing out is refused. A non-existent tail cannot be a symlink, so this is as safe as strict realpath for containment, and it keeps the existing "Browse non-existent directory -> `directory not found`" behaviour inside a root (strict realpath would turn it into a 403). Grant subjects themselves are compared verbatim (already realpaths).
- A root source that throws (store read error) contributes no roots for that request and logs once - fail closed. A root whose realpath fails (deleted / EACCES) is dropped.
- Cost budget: roots are realpath'd on every browse request. Budget: with 200 roots and a 200-entry directory, confined `/api/browse` p95 < 50 ms over 100 calls (L1 timed). Exceeding it -> add a store-revision-keyed roots cache.
- A confined `/api/browse` listing never offers a dead end like `~/Dropbox -> /Volumes/...`: `listDirectories` keeps only `Dirent.isDirectory()` entries, which excludes symlinks for every caller, so no extra filter is needed.
- `/api/browse`: path outside roots -> `403 {success:false, error:"path outside allowed roots"}`; listing inside roots -> `parent` forced to `null` when the parent is outside every root; response adds `confined: true` (absent for local callers). Type: optional `confined?: boolean` on `BrowseResult` in `packages/shared/src/rest-api.ts:401` (optional, so older servers stay compatible).
- Client mapping: `packages/client/src/lib/api/browse-api.ts` today maps only 403 `network_not_allowed` to `NetworkNotAllowedError` (`:55`); any other non-ok response throws a bare `Error(json.error)` in `browseDirectory` (`:59`) and `createDirectory` (`:104`). Add a typed `PathOutsideRootsError` (`code = "path_outside_allowed_roots"`, duck-typed like `NetworkNotAllowedError`) thrown by both on 403 `path outside allowed roots`; `PathPicker.tsx` branches on `code`, never on message text.
- `/api/browse/flags`: any path outside roots -> `403` (whole request; no partial disclosure).
- `/api/browse/mkdir`: `parent` outside roots -> `403`, checked before any fs write; nothing created.
- Residual: TOCTOU swap of `parent` for a symlink between check and `mkdir` needs local write access to a root - accepted.

### D3 - PTY cap: global + per-owner, inline terminals count, tab terminals never reaped

- Caps: `maxConcurrent` (default 32) over all live PTYs; `maxPerOwner` (default 16) over PTYs whose `principalOwner` equals the requester's (`{iss, sub}` equality). Ownerless terminals (identity plane inert) count only toward the global cap, so a single-user install sees one limit: 32.
- Ephemeral inline-terminal PTYs count toward both caps (they are real shells).
- Tab terminals are never reaped. Detached long-running shells (dev servers, watchers) are a supported use; the new requirement "Tab terminals are not reaped on idleness" is the guarantee (the existing `terminal-emulator` lifecycle requirement only describes cleanup on exit/close). The WIP all-terminal idle reaper and the per-cwd cap are removed.
- Orphaned inline PTYs ARE reaped: an ephemeral PTY with no attached client for 10 min (`terminals.inlineOrphanTtlMs`, default 600000) is killed through the existing kill path (orphan clock: starts at spawn, restarts at every last-client detach, stopped while any client is attached), so it follows the normal shell-exit route (bounded transcript tombstone, `TOMBSTONE_CAP`). Why: inline PTYs are hidden from the tab bar (`inline-terminal` spec), so without this a client looping `open_inline_terminal` could hold the global cap with shells no UI can close.
- Global-cap exhaustion by tab terminals: tab terminals are visible; in an inert (single-user) install the only filler is the user, who can close tabs. With the identity plane enforced, two principals at their per-owner cap can fill the global cap; the break-glass operator sees and can kill every terminal. Accepted; the A3 notice names the global scope so the operator knows to clean up.
- Ownership edge cases: ownerless PTYs (spawned while inert, or before the plane was enforced) count only toward the global cap; the break-glass operator is a principal like any other for the per-owner cap.
- Config: `terminals.maxConcurrent`, `terminals.maxPerOwner`, `terminals.inlineOrphanTtlMs` in `config.json`, parsed in `packages/shared/src/config.ts` alongside existing defaults; non-integer or `< 1` -> default (fail-safe, logged once). Read at `createTerminalManager` time (restart to apply).
- Refusal delivery: `spawn` keeps throwing `TerminalLimitError {scope: "global" | "owner", limit}` BEFORE any process is spawned. `handleCreateTerminal` / `handleOpenInlineTerminal` catch it and send `{type: "terminal_limit_reached", scope, limit, cwd, inline}` to the requesting socket only (no broadcast, no `terminal_added`, no `inline_terminal_open` event, no session-order insert). Any other error rethrows (gateway logs it).
- Client: new `ServerToBrowserMessage` member in `packages/shared/src/browser-protocol.ts`; the terminals view and the inline-card slot render the mockup-A notice (`role="status"`, `--severity-warning-*`, dismissible, replaced by the next rejection, cleared by the next successful spawn).

### D4 - Recovery: bind configured host; gate on genuinely-local + same-origin

- Bind `info.host ?? "127.0.0.1"`; `cli.ts` passes `config.host` (honours an operator's explicit `bindHost`).
- `isRecoveryActionAllowed` admits a mutating POST (`/api/recovery/retry`, `/api/recovery/reinstall`) iff:
  - the local IPC token is presented in `x-pi-local-token` and matches (timing-safe) - kept from WIP for CLI/tooling; OR
  - loopback peer AND no proxy-forwarding header (`x-forwarded-for`, `x-forwarded-host`, `x-forwarded-proto`, `x-real-ip`, `forwarded`) AND loopback `Host` AND (`Origin` absent OR `Origin` host:port equals the `Host` header host:port).
- Forwarding headers: the **extended** 8-header list (`x-forwarded-for`, `x-forwarded-host`, `x-forwarded-proto`, `x-real-ip`, `forwarded`, `via`, `x-forwarded-server`, `x-forwarded-port`) - the same stricter set used for the other credential-less admission path, plugin WS scopes (`localhost-guard.ts:41`, spec `plugin-ws-route`). Duplicated inline (node-built-in-only rule); `localhost-guard.ts` exports `PLUGIN_PROXY_FORWARDING_HEADERS` (today module-private) and a unit test pins the two lists equal.
- Same-origin (not "any loopback origin") closes a malicious page served from another local port, mirroring the main server's `cross-site-request-gate` "Mutating API requests reject untrusted Origins". Normalisation: `new URL(origin).host` with the scheme default port removed, lower-cased, compared to the `Host` header normalised the same way (`[::1]:8000` == `[::1]:8000`; `http://localhost` == `localhost:80`). `Origin: null` or unparseable -> refused.
- Posture: recovery actions are admitted only for a literal loopback URL (`localhost` / `127.x` / `[::1]` Host) or the IPC token. A tunnel or LAN hostname is never admitted, even with a matching Origin - the recovery page is only usable on the host.
- `GET /` and `GET /api/health` stay unauthenticated (diagnostics); on a default loopback bind they are local-only. An operator-configured non-loopback `bindHost` exposes them - accepted, same as the main server's health route.
- Docker: the host browser is not loopback to the container (see D1), so recovery actions are refused there; remedy copy for that case points to `docker compose restart` / `docker exec`. Accepted.
- Refused -> `403 text/plain` with remedy copy; the recovery page renders it as the mockup-C callout (`role="alert"`), buttons stay enabled.
- Residual: a marker-less `ssh -R` tunnel that also rewrites `Host` to `localhost` and sends no `Origin` passes. Accepted (requires the operator to have set up that tunnel).

## Spec collateral

A cap refusal contradicts unmodified "SHALL spawn" scenarios, so MODIFIED blocks (copied in full) add an "unless a terminal cap is reached" exception: `terminal-emulator` "Server-side PTY management" and `inline-terminal` (bare `!!` / composer button spawn). `filesystem-browser` "PathPicker component" gains the B1/B2 scenarios. `server-startup-recovery` "Recovery server module SHALL import only node built-ins" is corrected to the real path `packages/server/src/lifecycle/recovery-server.ts`.

## Risks / Trade-offs

- Remote picker users lose access to folders outside the shared set -> B1/B2 copy tells them to pin on the host.
- `isLocallyTrusted` in strict local-proof mode also requires local proof; a local browser without the proof cookie is then confined. Acceptable - same posture as every other local-only surface.
- Cap of 16 per owner could bite heavy multi-user operators -> configurable.

## Migration

None persisted. WIP code on `develop` is reworked in the worktree: narrow the reaper to orphaned inline PTYs, drop the per-cwd cap, add per-owner, move the browse gate behind D1, add the D1b pin/workspace gate, widen roots + forbidden filter per D2, tighten the recovery gate per D4 (extended header list, same-origin normalisation).
