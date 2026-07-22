# DOX — packages/server/src/embed-lifecycle

Files in this directory. One row per source file. Server-side lifecycle control plane for machine-fronted (`ephemeral`) sessions: idempotent acquire, idle reaper, active-session caps, observability — all off by default (`config.embedLifecycle.enabled`). See change: add-embed-session-lifecycle.

| File | Purpose |
|------|---------|
| `caps.ts` | Active-session caps admission gate. `createCapsAdmission(deps)` → `{ admit(key) }`; counts only ephemeral, reclaims oldest quiescent, else throws `CapacityError` (exported). Global cap = hard bound; shared `reclaimGuard` avoids double-select. |
| `cwd-allowlist.ts` | `isCwdAllowed(cwd, allowedRoots, {realpath?})` — realpath + `within` containment; empty allowlist denies (D11). |
| `embed-lifecycle-controller.ts` | Server-integration facade. `createEmbedLifecycleController(deps)` → `{ metrics, reaper, start, stop, snapshot }`; wires the live reaper + metrics to sessionManager/browserGateway/terminalManager/pidRegistry/piGateway. Dormant when disabled. |
| `idle-reaper.ts` | Three-gear reaper loop. `createIdleReaper(deps)` → `{ sweepOnce, start, stop }`; assembles signals, calls `decideReap`, applies (idle/phantom → `killBySessionId`, stop-after-turn → latch). `CPU_IDLE_THRESHOLD`. |
| `identity-key.ts` | Canonical identity key. `canonicalizeCwd` (realpath + case-normalize via `caseInsensitiveFilesystem`), `buildIdentityKey`, `composeIdentityKey`, `visitorIdOf`. NUL-joined `visitor + cwd + agent` (D10). |
| `lifecycle-event-capture.ts` | `captureLifecycleTimestamp(eventType, now)` → `{lastRunStartedAt}` / `{lastSettledAt}` / null. Version-agnostic settle capture (keys on event name, no piVersion branch). Wired in `event-wiring.ts`. |
| `lifecycle-metrics.ts` | Observability counters. `createLifecycleMetrics(deps)` → `{ recordReap, recordCapacityReject, recordReuse, snapshot }`. Live active/idle from injected accessors; cumulative reap/reuse/reject. Exposed via `/api/health` `embedLifecycle`. |
| `liveness-probe.ts` | Bounded pid-tree + CPU probe. `createLivenessProbe({timeoutMs?,runPs?})` → `(rootPid)⇒LivenessSnapshot`; pure `summarizeProcessTree` + `parsePsOutput`. `{ok:false}` on ps failure ⇒ safe direction. |
| `quiescence.ts` | Pure reap-decision core. `decideReap(signals, thresholds, now)` → `{action,reason}`; `isAtRest`, `isWithinGraceWindow`. Encodes 3 gears + every veto (X4 matrix, X5 phantom guard). `LifecycleSignals`, `LifecycleThresholds`, `ReapReason`. |
| `session-lifecycle-policy.ts` | Provenance accessor. `isEphemeral(session)`, `effectiveLifecyclePolicy(session)` — absent `lifecyclePolicy` ⇒ `"durable"` (D1). Every downstream gate reads through here. |
| `visitor-session-registry.ts` | Idempotent acquire. `createVisitorSessionRegistry(deps)` → `{ acquire, resolveByCwd, mappedSessionId }`; coalescing `key→Promise`, reuse→resume→spawn ladder, bounded register timeout (X2), key re-point across resume renumber (E10). |
