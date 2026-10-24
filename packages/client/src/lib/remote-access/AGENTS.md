# DOX — packages/client/src/lib/remote-access

Remote access wizard engine + I/O. Pure engine first; hooks and wrappers over EXISTING endpoints. See change: add-remote-access-wizard.

| File | Purpose |
|------|---------|
| `__tests__/connect-machine.test.ts` | Address parse/normalise, `ensureKnown` (no re-POST of a match, 409 already_known / identity_changed, 403 refusal), `knockDecision` combos. |
| `__tests__/steps.test.ts` | Step engine: plans per task, satisfaction table, door predicate, bind/LAN road states, device branch insertion, folding, approve diff. |
| `__tests__/use-readiness-poll.test.ts` | P1: 1 read on open, 0 on landing, in-flight skip, +1 on return, stop on unmount. |
| `__tests__/use-remote-access-snapshot.test.tsx` | Loading never rendered as Off; failed read = unknown + retry; live broadcast outranks config. |
| `connect-machine.ts` | Connect-to-another-machine logic. Exports `parseAddress`, `sameAddress`, `findKnown`, `ensureKnown` (add → AddOutcome), `knockDecision`, `remoteOrigin`, `remoteRequestUrl`. A known match is never re-POSTed (would overwrite label). `409 self_address` ⇒ `{kind:"self-address"}` (inline error, task not stopped). See change: harden-peer-address-identity. |
| `ra-api.ts` | Typed I/O keeping HTTP status. Reads throw on any failure (`readConfig`, `readStatusDetail`, `readEndpoints`); writes return `ActionResult` ok / refused (401/403) / failed. `restartServer` treats a dropped connection as restart underway. No new route. |
| `reachability-store.ts` | Module singleton for `reachability_updated` (`reachabilityStore`, `useLiveReachability`). Fed by `App.tsx`; replayed by the server on connect. |
| `run-store.ts` | `sessionStorage["remoteAccess.run"]` resume. `saveRun`, `takeFreshRun` (read AND remove; null when ≥ `RESUME_TTL_MS` = 120s), `clearRun`, `hasStoredRun`. |
| `steps.ts` | PURE step engine. `Tri<T>` sources, `evaluate(step)`, `planTask(task, snap, run)` → rows/current/k/n, `foldRows`, `roads()`, `deviceEndpoint`, `endpointTransport`, `taskHint`, `approveOutcome`, `openEntries` (door predicate: loopback-only = `isLoopbackOnlyEntry` + `::1`; no server change). Unloaded/failed input → `sat: "unknown"`. |
| `use-readiness-poll.ts` | `useReadinessPoll(active, read)` — sole owner of the readiness loop; immediate tick + 5s while `active`, overlap-suppressed; `tick()` for open/landing return/Refresh. |
| `use-remote-access-snapshot.ts` | `useRemoteAccessSnapshot(open, pollActive)` — one config/status/endpoints/readiness snapshot, re-read on `refresh()` and when the live bind facts change; exposes `pendingCount`. |
