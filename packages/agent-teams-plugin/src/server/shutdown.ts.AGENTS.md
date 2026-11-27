# shutdown.ts — index

`createShutdown`: request records, `ShutdownRequest`/`ShutdownResponse` ops, approval → release tasks → driver `shutdown` after settle or `shutdownGraceMs` (once), reject returns to prior state + waking notice, server-request timeout wake, `consume` for `releaseMember`, `pendingCount` (all-resolved wake rule).
