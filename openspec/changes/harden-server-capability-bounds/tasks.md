# Tasks

## 1. PTY cap (B7)

- [ ] 1.1 Add a global + per-cwd concurrent-PTY cap in `terminal-manager.ts`; reject `create_terminal` over cap with a clear error.
- [ ] 1.2 Add an idle/detached-terminal reaper (release PTY + ring buffer).
- [ ] 1.3 Pick defaults that allow normal multi-terminal use; make configurable if warranted.

## 2. Browse/mkdir confinement (B8)

- [ ] 2.1 Compute the allowed-root set (`$HOME` + pinned dirs) and enforce containment on `/api/browse`, `/api/browse/mkdir`, `/api/browse/flags` (reuse/extend `lib/path-containment` logic).
- [ ] 2.2 Reject paths escaping the roots; confine `mkdir` to the roots.
- [ ] 2.3 Confirm the folder-picker still lists workspaces under `$HOME`/pinned.

## 3. Recovery server lockdown (B9)

- [ ] 3.1 Pass the configured host to `recovery-server.ts` `listen()` (loopback default).
- [ ] 3.2 Gate `reinstall`/`retry` POSTs on loopback or local-token.

## Tests

- [ ] T1 PTY: at cap, `create_terminal` rejected; under cap, spawns; idle terminal reaped.
- [ ] T2 Browse: `/api/browse?path=/` rejected; browse under `$HOME` succeeds.
- [ ] T3 mkdir: outside roots rejected (nothing created); inside roots succeeds.
- [ ] T4 Recovery: bound to loopback (not 0.0.0.0); remote `reinstall` rejected; loopback `retry` works.

## Discipline checkpoints

- [ ] D1 `doubt-driven-review` — confirm normal terminal usage + folder-picker UX survive the cap/confinement.
- [ ] D2 `security-hardening` — STRIDE the allowed-root computation (symlink escape via realpath) and the recovery gate.
- [ ] D3 `scenario-design` — allowed/escape × at-cap/under-cap × loopback/remote realized as T1–T4.

## Validate

- [ ] V1 `openspec validate harden-server-capability-bounds --strict` passes.
- [ ] V2 `npm test` green (terminal-manager, file-routes/browse, recovery suites).
- [ ] V3 Manual: over a tunnel, `/api/browse?path=/` returns a containment error; recovery reinstall from a non-loopback origin is refused.
