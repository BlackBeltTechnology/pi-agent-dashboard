# Harden Server Capability Bounds

## Why

The security-boundary-audit found three server-side dangerous capabilities that
are authenticated but under-constrained. Each is reachable by an authenticated
caller (paired device over the tunnel, or same-host); the gap is that the
capability itself has no bound.

- **B7 — Unbounded PTY spawn (`terminal-manager.ts`).** An authenticated client
  can loop `create_terminal`; each spawn allocates a 256 KB ring buffer plus a
  real OS shell process with no ceiling on concurrent terminals and no idle
  reaper → memory / PID exhaustion (DoS).
- **B8 — Unconstrained directory browse + mkdir (`routes/file-routes.ts`:
  `/api/browse`, `/api/browse/mkdir`, `/api/browse/flags`).** These carry only
  `networkGuard`, not the path containment applied to `/api/file*`. `/api/browse?path=/`
  enumerates the whole filesystem; `/api/browse/mkdir` creates a directory at an
  arbitrary parent. Over the tunnel this is a full FS-enumeration + FS-write
  primitive outside the containment model.
- **B9 — Unauthenticated recovery server on all interfaces
  (`recovery-server.ts`).** In recovery mode `server.listen(port)` binds with no
  host arg → all interfaces. `POST /api/recovery/reinstall` runs `npm install -g`
  (executes lifecycle scripts) and `/retry` respawns the CLI, with no auth on any
  route during the failure window.

## What Changes

- **Cap PTYs.** Enforce a global and per-cwd concurrent-terminal limit; reject
  `create_terminal` over the cap; reap idle/detached terminals.
- **Confine browse/mkdir.** Restrict `/api/browse`, `/api/browse/mkdir`, and
  `/api/browse/flags` roots to `$HOME` plus pinned directories; reject
  enumeration above those anchors and `mkdir` outside them.
- **Lock down recovery.** Bind the recovery server to the configured host
  (loopback by default) and gate the `reinstall`/`retry` POST actions on a
  loopback / local-token check.

Out of scope: the terminal `cwd` validation defense-in-depth (audit B10-adjacent
low), which the universal-guard + containment work covers.

## Impact

- **Closes:** B7 PTY DoS, B8 filesystem enumeration/write outside containment,
  B9 unauthenticated all-interfaces recovery actions.
- **Risk:** the browse confinement must still allow the legitimate folder-picker
  UX (choosing a workspace under `$HOME` or a pinned dir). The PTY cap must be
  high enough for normal multi-terminal use. Both need sensible defaults verified
  against real usage.
- **Affected specs:** new capability `server-capability-bounds`.
- **Affected code:** `packages/server/src/terminal-manager.ts`,
  `packages/server/src/routes/file-routes.ts` (browse), `packages/server/src/recovery-server.ts`.

## Discipline Skills

- `security-hardening` — DoS bounding, path containment, least-privilege bind.
- `doubt-driven-review` — confirm the folder-picker and normal terminal usage are
  not broken by the confinement/cap before merge.
- `scenario-design` — allowed-root vs escape, at-cap vs under-cap, loopback vs
  remote recovery matrix.
