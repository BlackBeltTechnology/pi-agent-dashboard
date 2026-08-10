# session-bootstrap.ts — index

Exports `discoverAndBroadcastSessions(deps)` — async startup discovery from known directories, restores sessions, extracts token stats, starts OpenSpec polling, fire-and-forget initial per-directory poll broadcast on prior-empty or diff. Non-blocking.
