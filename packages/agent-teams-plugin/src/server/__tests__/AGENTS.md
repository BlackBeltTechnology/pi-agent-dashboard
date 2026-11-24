# DOX — packages/agent-teams-plugin/src/server/__tests__

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `store-persistence.test.ts` | Store persistence (test-plan S74–S83, S136): restart reload, crash-safe write, write-through + shutdown flush, mutation order, mail-log compaction BVA, quarantine of corrupt/future files, closed pruning, persist failure, closing-team resume. |
| `runtime.test.ts` | Lifecycle through the real request-lane handlers on the fake runtime host: member names, caps, lead role, modes, store events, owner/committer/starting team, races, identity/origin/confinement/trusted options, TeamStatus/TeamDelete/actor ops, member exit, orphan TTL, extension points, hello/busy/idle/ack, session driver; plus dispatch/notices/delivery across lead states (S39 dispatch half, S40, S42, S67) on the real mail engine. |
| `spawn-scope.test.ts` | Host bindings + teammate scope, server half (S45, S48–S52, S55, S63–S66, S75, S84, S86, S112–S117, S119, S120): cwd confinement (real temp dirs, symlinks), spawn scope/env/policy, skill layer 1, spawn → bind → guarded hello → ack flow, failures/timeouts, resume, restart reconcile, guard-ready hello, session end. |
| `tasks.test.ts` | Task list + dispatcher over the lane (S21–S33, S59–S62, S138): limits, cap, dependencies/cycles, claim, transition matrix, owner assignment, completion, listing, dispatch + skip set, error settle, release on exit, owner lock, same-tick races, 60-task soak. |
| `messaging.test.ts` | Delivery/urgent/idle/coalescing/shutdown (S4–S20, S68–S70, S72, S96–S97, S105–S110) on the real mail engine; SERVER half of rows that also have a bridge half. |
| `mail-rate.test.ts` | Token bucket (S53, S71) and pair loop breaker (S54, S73) on the injected clock. |
| `perf-budgets.test.ts` | Regression gates: store-op p99 (S125), 100k-mail persistence soak (S128), lead wake cost (S129), no polling (S130). |
