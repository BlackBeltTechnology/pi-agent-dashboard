# inproc-lead.ts — index

`createInProcLead`: lead lifecycle. `onSessionEnded(lead)` ⇒ team closed `lead_ended` (members `gone: lead_ended`, tasks released, ONE flushed notice, queued commands failed, `pendingStops` recorded); `onReload(team)` ⇒ same with `lead_reloaded` (lead still connected, notice delivered first); both idempotent. `recordStop` (cap = members ever, `PENDING_STOP_TTL_MS` 24 h), `onHello(session, incarnation)` (same incarnation ⇒ `driver.stopChild` once per child; other ⇒ discarded + logged), `expireStops`. See change: add-agent-teams-in-process.
