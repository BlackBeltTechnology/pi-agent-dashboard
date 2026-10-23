# bind-reachability-service.ts — index

Server inputs to the shared reachability predicate. `initBindReachability({resolvedBindHost, hostFlag})` freezes the boot value; `computeBindReachability(loadConfig)` re-resolves `pendingBindHost` against the CURRENT config; `getLastBindReachability()` backs the WS connect-replay; `formatBindReachabilityWarning` emits the `[bind-reachability]` startup line. Deliberately NOT on `/api/health` (no preHandler; this is network topology). See change: warn-unreachable-trusted-networks.
