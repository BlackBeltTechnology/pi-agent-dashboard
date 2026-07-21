# selectViewedSessionId.ts — index

Pure selector for currently-viewed session id from `/session/:id` route. Exports `selectViewedSessionId(match, params)` → `string | null`. Unit-testable independent of wouter (pass match bool + params). See change: session-card-unread-stripes.
