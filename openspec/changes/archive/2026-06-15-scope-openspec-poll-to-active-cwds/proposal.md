## Why

The server-side OpenSpec poller starves the Node event loop on this user's setup, producing two visible symptoms: (1) the dashboard web UI / `index.html` takes up to ~30 s to load, and (2) mid-session LLM token streaming stalls until the page is reloaded. Both trace to the same mechanism — expensive poll ticks block the single event loop, delaying both HTTP responses and the WebSocket frames that carry streamed tokens.

Root cause measured on a live server: `computeKnownDirectories()` in `packages/server/src/directory-service.ts:277` builds the per-tick work set from **every** session's cwd via `sessionManager.listAll()`, which includes **ended and hidden** sessions. On the affected machine this yields **24 distinct cwds polled every tick when only 4 have an active session** — 20 are stale (6 point at deleted directories), and one active cwd is a repo with **62 OpenSpec changes** that is re-listed and re-derived on every gate-opening tick.

Consequences:
- **Cold/boot ticks** fan out `openspec list` across all 24 cwds (pre-`#109`, also `openspec status` per change) → the 69 s event-loop blocks observed in `server.log`.
- **Session hiding does nothing** to reduce poll load, because hidden sessions are still enumerated by `listAll()`. Users who hide old sessions to "clean up" get no performance benefit — a surprising, undocumented gap.
- The poller keeps probing **deleted worktree directories** forever (the recurring `[openspec-watcher] attach failed ... (ENOENT); periodic poll will cover this cwd` log spam).

This change scopes the poll work set to directories the user is actually working in: active (non-ended) session cwds plus explicitly pinned directories. It makes session-hiding an effective performance lever and stops chasing dead cwds.

## What Changes

- **MODIFY** `computeKnownDirectories()` in `packages/server/src/directory-service.ts` — filter the session-derived cwds to **non-ended** sessions only. Pinned directories continue to be polled unconditionally (pinning is an explicit "watch this" signal, independent of session state).
  - Before: `for (const session of sessionManager.listAll()) dirs.add(session.cwd)`
  - After: `for (const session of sessionManager.listAll()) if (session.status !== "ended") dirs.add(session.cwd)`
- **BEHAVIOR** — a cwd whose sessions have all ended stops being polled until (a) a new session registers in it, or (b) it is pinned. Its OpenSpec subcard refreshes on next session open / pin rather than continuously in the background. Pinned-but-ended cwds keep polling (unchanged).
- **NEW** `packages/server/src/__tests__/directory-service-known-dirs.test.ts` — asserts `computeKnownDirectories()` excludes ended/hidden session cwds, includes active session cwds, and includes pinned dirs regardless of session state.
- **MODIFY** `broadcast()` in `packages/server/src/browser-gateway.ts` — **serialize the payload once per broadcast**, not once per client. Today `broadcast()` loops every subscriber and `sendTo()` calls `JSON.stringify(msg)` for each (`browser-gateway.ts:262`), so a fan-out to C clients stringifies the payload C times. Stringify once, then `ws.send(serialized)` to every open socket (preserving the existing `MAX_WS_BUFFER` back-pressure drop). This is broadcast-layer and benefits **all** ~20 `broadcastToAll` call sites, but is motivated here by the large `openspec_update` payload (62-change repo) that recurs every gate-opening tick — the per-client stringify is a direct contributor to the WebSocket frame delays behind the LLM-stream-hang symptom.
- **NEW** `packages/server/src/__tests__/browser-gateway-broadcast-serialize-once.test.ts` — spy on `JSON.stringify` (or inject a serializer) and assert one serialization per `broadcast()` regardless of subscriber count; assert each open socket still receives the identical frame and that a buffer-full socket is still skipped.
- **DOCUMENTATION** — `docs/architecture.md` OpenSpec-polling section: document that the poll work set = active session cwds ∪ pinned dirs, and that hiding/ending sessions reduces poll load. Note the broadcast serialize-once behavior in the matching `docs/file-index-server.md` rows for `directory-service.ts` and `browser-gateway.ts`.

## Non-Goals

- No change to poll interval, jitter, concurrency, or the mtime gate (those are runtime config, already tunable via `DashboardConfig.openspec`).
- No change to `#117` emit-pending behavior — investigation showed it is bounded to discovery time and is not the cost driver.
- No new persistence, schema, or protocol fields. Pure in-memory work-set scoping.

## Migration / Compatibility / Rollback

- **Migration**: none. `computeKnownDirectories()` is computed fresh each tick from in-memory state; the change takes effect on the next tick after deploy. No stored data touched.
- **Compatibility**: the `server-openspec-polling` spec's "known directories" definition narrows from "pinned dirs + session cwds" to "pinned dirs + active session cwds". Browsers receive `openspec_update` for fewer cwds; the client already keys all OpenSpec state by cwd and tolerates absent cwds (renders nothing / refreshes on open).
- **Rollback**: revert the one-line filter. No data cleanup required.
- **Risk**: an ended-but-unpinned cwd shows slightly staler OpenSpec data until reopened. Mitigation: the `onDirectoryAdded` immediate-poll path already fires when a session registers, so reopening a cwd repopulates it within one tick.
