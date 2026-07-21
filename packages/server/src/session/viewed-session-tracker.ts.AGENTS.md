# viewed-session-tracker.ts — index

Exports `ViewedSessionTracker` interface, `createViewedSessionTracker()` — per-session set of viewing WebSocket connections. Methods: `view`, `unview`, `unviewAll(ws)`, `isViewedByAnyone`, `viewerCount`. Gates unread stamps; global read state across browsers. In-memory only.
