## Why

`mirror-dashboard-trust-to-pi` mirrors only **durable** dashboard trust to pi sessions on the **same machine**, decided from a server-written snapshot with no server round trip. It deliberately defers two cases that need a live server and a real proof, and so a different design:

- **Server-lifetime trust** never reaches pi today: worktree-init trust "until dashboard restarts", session-scoped access grants, and every YOLO session (`packages/server/src/access/yolo-session.ts` keeps YOLO in memory only). The worktree-init spec requires session-scope trust to stay memory-only, so it cannot go into the snapshot.
- **Bridges on other machines** (or containers without a shared view of the dashboard directory) get no dashboard trust, because the same-folder proof in the parent change (path + device + inode + birth time) only holds on one machine.

The parent change has landed (archived 2026-10-18), so this change can now be planned.

## What Changes

- **NEW** live trust query: at `project_trust` the bridge asks the server through one authenticated one-shot HTTP request, made only when the snapshot does not cover the cwd and either live entries exist or the bridge is remote. The snapshot carries only a live-entry count, never identities, to respect the memory-only rule. One deadline, `piTrustMirror.liveQueryTimeoutMs` (default 300 ms, clamped 50–1000), bounds the request and the proof check. The server rate-limits per requester and logs and counts budget misses. The query does not use the gateway WebSocket, which is not open at the first `project_trust` (it connects in `session_start`).
- **NEW** live sources: session-scoped worktree-init trust, session access grants, and YOLO sessions (scoped roots until expiry; env-scoped roots while the process lives; unscoped never). Operator decision carried over: the YOLO source defaults ON (`piTrustMirror.sources.yolo`).
- **NEW** folder proof in every live answer, checked by the bridge:
  - a genuinely local requester gets the device + inode (+ birth time) recorded when the live entry was created, so a re-created folder does not inherit trust;
  - a remote requester, a paired device, gets a salted digest, bound to the cwd, of the *content* of pi's trust-requiring resources for that cwd (`.pi/{settings.json,mcp.json,extensions,skills,prompts,themes,SYSTEM.md,APPEND_SYSTEM.md}` plus ancestor `.agents/skills`). An empty or oversized set fails closed.
  Operator decision carried over: remote bridges are supported when the proof holds.
- **Settled questions**:
  - (1) A shared secret proves only that the requester can read the dashboard directory, which is the same user and home. The existing credential verdict (loopback local-credential proof vs paired-device bearer) authenticates the requester, so no new secret is added; folder identity is a separate proof.
  - (2) Readiness: a one-shot request avoids waiting for the WebSocket.
  - (3) `enabled` and `liveQuery`: the bridge checks `config.json` first, so they work while the server is down, and the server re-checks its own config in every answer; both must allow. `coverInteractive` is enforced by the bridge only, because the server cannot verify a session kind.
- **NEW** server-side consumers (`host.isProjectTrusted`, the MCP view) see live entries too, so they match what a local pi decides.
- **NEW** `piTrustMirror.liveQuery` (default true) turns the live path off as a rollback lever without touching durable mirroring.

## Capabilities

### New Capabilities
- None — extends `pi-trust-mirror`.

### Modified Capabilities
- `pi-trust-mirror`: live sources, live query, folder proofs, live-count snapshot field, new settings, Access-page disclosure of live trust.
- `bridge-extension`: the `project_trust` handler gains the bounded async live path.

## Impact

- `packages/server` (live source registry, `POST /api/pi-trust/query` route + rate limiter + counters, snapshot `liveCount`), `packages/extension` (async handler path, local-proof / bearer request), `packages/shared` (query request/response types, listing digest, config fields), `packages/client` (Access page live list, YOLO / session-trust disclosure).
- Depends on: `mirror-dashboard-trust-to-pi` (must land first).

## Discipline Skills

- `security-hardening`: remote untrusted input, secret challenge–response, live widening of trust.
- `performance-optimization`: a bounded wait on pi's startup path.
- `doubt-driven-review`: changes a security boundary across machines.
- `observability-instrumentation`: budget-miss and rate-limit logging.
