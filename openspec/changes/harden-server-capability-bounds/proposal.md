# Harden Server Capability Bounds

## Why

The security-boundary-audit found three server-side dangerous capabilities that
are authenticated but under-constrained. Each is reachable by an authenticated
caller (paired device over the tunnel, or same-host); the gap is that the
capability itself has no bound.

- **B7 — Unbounded PTY spawn (`terminal/terminal-manager.ts`).** An authenticated
  client can loop `create_terminal` / `open_inline_terminal`; each spawn allocates
  a 256 KB ring buffer plus a real OS shell process with no ceiling on concurrent
  terminals → memory / PID exhaustion (DoS).
- **B8 — Unconstrained directory browse + mkdir (`routes/file-routes.ts`:
  `/api/browse`, `/api/browse/mkdir`, `/api/browse/flags`).** These carry only
  `networkGuard`, not the path containment applied to `/api/file*`. Over the
  tunnel `/api/browse?path=/` enumerates the whole filesystem and
  `/api/browse/mkdir` creates a directory at an arbitrary parent.
- **B9 — Unauthenticated recovery server on all interfaces
  (`lifecycle/recovery-server.ts`).** In recovery mode `server.listen(port)` binds
  with no host arg → all interfaces. `POST /api/recovery/reinstall` runs
  `npm install -g` and `/retry` respawns the CLI, with no auth and no
  cross-site protection on any route during the failure window.

A first implementation pass is on `develop` (WIP `1d546c995`) and was handed back
to planning; `design.md` records decisions that rework parts of it.

## What Changes

- **Cap PTYs (D3).** Global cap (default 32) + per-owner cap (default 16, applies
  only while the identity plane stamps owners); inline terminal cards count.
  Configurable via `terminals.maxConcurrent` / `terminals.maxPerOwner`. Tab
  terminals are never reaped — detached long-running shells stay; only orphaned
  inline PTYs (no attached client for 10 min) are reaped so hidden shells cannot
  hold the cap. A refused spawn starts nothing and
  sends `terminal_limit_reached {scope, limit, cwd, inline}` to the requesting
  socket; the client shows a dismissible notice.
- **Confine remote browse/mkdir (D1, D2).** Requests that are not genuinely local
  (`isLocallyTrusted` false: tunnel, LAN, relayed loopback) are confined to the
  shared-root set: `$HOME`, pinned dirs, session cwds, workspace folders,
  worktree-init roots, access-grant subjects (realpath-compared). Outside → 403
  `path outside allowed roots`; `parent` is `null` at a root top; response carries
  `confined: true`. Forbidden subjects (`/`, system roots, `~/.ssh`, `~/.pi`)
  never count as roots. Remote sockets cannot widen the set: a remote
  `pin_directory` / workspace-folder add outside it is refused. Local callers
  are unchanged.
- **Lock down recovery (D4).** Bind the configured host (loopback default). Gate
  `retry`/`reinstall` on the local token, or on loopback peer + no proxy-forwarding
  header + loopback `Host` + same-origin `Origin`. Refusal copy rendered on the
  recovery page.
- **Mockup:** `mockups/index.html` (in this change) — A terminal-limit notice,
  B remote folder picker (B1 root hint, B2 refusal), C recovery refusal.

Out of scope: terminal `cwd` validation (audit R1, owned by
`close-residual-audit-findings`); a remote "request access" flow;
`/api/browse/create-project` (already confined to `<home>/Projects`).

## Impact

- **Closes:** B7 PTY DoS, B8 remote filesystem enumeration/write outside shared
  folders, B9 unauthenticated all-interfaces / cross-site recovery actions.
- **Residual (documented):** a marker-less relay (`ssh -R`) presenting as
  loopback is treated as local unless `requireLocalProof` is on; Docker host
  browsers are treated as remote (confined picker, recovery refused).
- **Risk:** remote picker users can no longer reach unshared folders (B1/B2 copy
  explains the fix: pin on the host). Caps must not bite normal use (32/16,
  configurable).
- **Affected specs:** new `server-capability-bounds`; MODIFIED
  `filesystem-browser` (browse / flags / mkdir APIs: remote confinement replaces
  the stale "localhost only" scenarios; PathPicker B1/B2 states),
  `server-startup-recovery` (bind host, gated actions, module path),
  `terminal-emulator` + `inline-terminal` (spawn refused at a cap);
  ADDED `shared-protocol` (`terminal_limit_reached`, `folder_refused`).
- **Affected code:** `packages/server/src/terminal/terminal-manager.ts`,
  `browser-handlers/terminal-handler.ts`, `routes/file-routes.ts`,
  `lib/browse-roots.ts`, `browser-handlers/directory-handler.ts` + workspace
  handlers, `pairing/browser-gateway.ts` (per-socket locality bit),
  `lifecycle/recovery-server.ts`, `auth/localhost-guard.ts`
  (export header list), `cli.ts`, `server.ts` (deps wiring);
  `packages/shared/src/browser-protocol.ts`, `config.ts`;
  `packages/client/src/components/primitives/PathPicker.tsx`, terminals view +
  inline terminal card, message handler.

## Discipline Skills

- `security-hardening` — DoS bounding, path containment, least-privilege bind,
  CSRF on the recovery server.
- `doubt-driven-review` — the D1–D4 decisions before they stand; folder-picker and
  normal terminal usage must survive.
- `scenario-design` — local/remote × inside/outside roots, at/under cap ×
  owner/global, loopback/tunnel/cross-site recovery matrix.
- `observability-instrumentation` — log line on cap refusal, browse refusal and
  recovery refusal (scope, no path contents beyond the requested path).
