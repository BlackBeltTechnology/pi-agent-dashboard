# dashboard-state-caller.ts — index

`stateCallerFor(request, localTrust)` → `StateCaller {gatedAdmitted(), unproven()}`, lazily from the SAME predicates the guard uses (`isLocallyTrusted`, `authVia==="session"`, `needsLocalProof`). Installed per request by the `onRequest` hook in `server.ts` via `runWithStateCaller`. See change: close-container-loopback-impersonation (D8).
