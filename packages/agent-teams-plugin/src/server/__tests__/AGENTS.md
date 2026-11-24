# DOX — packages/agent-teams-plugin/src/server/__tests__

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `store-persistence.test.ts` | Store persistence (test-plan S74–S83, S136): restart reload, crash-safe write, write-through + shutdown flush, mutation order, mail-log compaction BVA, quarantine of corrupt/future files, closed pruning, persist failure, closing-team resume. |
| `runtime.test.ts` | Lifecycle through the real request-lane handlers on the fake runtime host: member names, caps, lead role, modes, store events, owner/committer/starting team, races, identity/origin/confinement/trusted options, TeamStatus/TeamDelete/actor ops, member exit, orphan TTL, extension points, hello/busy/idle/ack, session driver. |
