## Why

`mirror-dashboard-trust-to-pi` mirrors only **durable** dashboard trust to pi sessions on the **same machine**, decided from a server-written snapshot with no server round trip. It deliberately defers two cases that need a live server and a real proof, and so a different design:

- **Server-lifetime trust** never reaches pi today: worktree-init trust "until dashboard restarts", session-scoped access grants, and every YOLO session (`packages/server/src/access/yolo-session.ts` keeps YOLO in memory only). The worktree-init spec requires session-scope trust to stay memory-only, so it cannot go into the snapshot.
- **Bridges on other machines** (or containers without a shared view of the dashboard directory) get no dashboard trust, because the same-folder proof in the parent change (path + device + inode + birth time) only holds on one machine.

Stub change: records the deferred scope and the decisions already taken, so it is planned with `plan-proposal` after the parent change lands.

## What Changes

- **NEW** live trust query: the bridge asks the server over its existing WebSocket (`trust_query`) at `project_trust` when the snapshot does not cover the cwd and live entries exist (the snapshot may carry only a count, never identities — memory-only rule), bounded by `piTrustMirror.timeoutMs` (default 300 ms, clamped 50–1000), with per-connection rate limiting and logged budget misses.
- **NEW** live sources: session-scoped worktree-init trust, session access grants, YOLO sessions (scoped roots until expiry; env-scoped while set; unscoped never). Operator decision carried over: the YOLO source defaults ON.
- **NEW** remote-bridge proof: a per-connection challenge–response over a dashboard trust secret that is never transmitted, plus a folder-identity proof that does not depend on the device number (bind mounts / NFS), with explicit handling for inode reuse and missing birth times. Operator decision carried over: remote bridges are supported when the proof holds.
- Open design questions to settle in planning: whether a shared secret proves more than readability of the dashboard directory; WebSocket readiness at `project_trust` time; how a live answer coexists with the snapshot's `enabled` switch read from `config.json`.

## Capabilities

### New Capabilities
- To be defined during planning (likely extends `pi-trust-mirror` rather than adding a capability).

### Modified Capabilities
- `pi-trust-mirror` (after the parent change is archived): live sources, live query, remote proof.
- `bridge-extension`: `project_trust` handler gains the live path.

## Impact

- `packages/server` (`pi-gateway` `trust_query` + challenge, live source registry), `packages/extension` (async handler path), `packages/shared` (protocol messages).
- Depends on: `mirror-dashboard-trust-to-pi` (must land first).

## Discipline Skills

- `security-hardening`: remote untrusted input, secret challenge–response, live widening of trust.
- `performance-optimization`: a bounded wait on pi's startup path.
- `doubt-driven-review`: changes a security boundary across machines.
- `observability-instrumentation`: budget-miss and rate-limit logging.
