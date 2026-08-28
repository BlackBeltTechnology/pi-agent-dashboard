## Why

Invoice assistant greetings are delivered to the browser as app-level domain-event
frames, but the app-level channel's reconnect cache retains only the **latest**
frame per entity key and is documented as "never a historical log". Every greeting
for one invoice shares that key, so a session that emits greetings as its invoice
advances through states keeps only the newest one for replay. A measured run
(three greetings `partner_pending → pending_approval → exported`) replays exactly
one frame on reconnect — `["exported"]`. The greeting is also persisted to the
transcript as a `display:false` custom message purely for model context, which by
design does not render. The net effect: a client that mounts or reconnects sees at
most the newest greeting instead of the chronological greeting stream, and no
chat-row rendering path exists for greeting frames at all. A greeting stream must
survive as long as the chat it belongs to.

## What Changes

- Introduce a **durable, per-session, chronologically-ordered replay** for
  greeting domain events, so a client that connects/reconnects/mounts after
  greetings were emitted receives the full stream in order — not just the latest.
  Replayed greeting frames are marked `replay: true` and carry a stable ordering
  key so a consumer can apply them idempotently.
- Carve greeting-type domain events out of the existing **latest-per-key
  convergence** retention: greetings are retained as an ordered stream, so the
  reconnect replay no longer collapses them to their newest state. Non-greeting
  domain events (invoice card state, connectors, etc.) keep the unchanged
  latest-per-key convergence behavior.
- **Fold greeting domain-event frames into chronological chat rows** in the chat
  reducer, ordered correctly relative to ordinary assistant/user rows, live and on
  replay, idempotent across re-replay by the greeting's stable id.
- **Carry the greeting's structured `state` onto the folded chat message** as an
  additive optional field (the fold currently drops it, keeping only joined text),
  so consumers read the state from structure, never by scraping content.
- **Expose `data-greeting-marker="<state>"` on greeting rows** from the structured
  field via a greeting-specific branch/wrapper in the chat view, leaving the shared
  message-bubble renderer (used by every assistant row in every session) untouched
  and non-greeting rows byte-identical.
- **Pin the raw-HTML rendering contract** (markdown renderer with raw-HTML
  pass-through and no HTML sanitizer) with a test, since a producer-authored per-
  state glyph arrives as raw inline `<svg><path/></svg>` in greeting content; the
  test fails loudly if a sanitizer is later added that would strip the glyph.
- No change to the `display:false` transcript copy: it continues to persist for
  model context and continues to render nowhere (verified: the reducer and replay
  paths both gate rendering on `display` being truthy).
- No change to the live app-level delivery of greeting frames or to the wire
  frame shape `{ type: "ib_domain_event", sessionId, event: { eventType, data } }`.

## Capabilities

### New Capabilities

- `invoicebot-greeting-stream`: durable per-session ordered retention and
  on-connect replay of greeting domain events, plus the chat reducer folding of
  greeting frames (live and replayed) into chronological chat rows, idempotent by
  the greeting's stable id, positioned correctly relative to assistant/user rows.

### Modified Capabilities

- `invoicebot-app-level-events`: the "latest event per key only — never a
  historical log" retention requirement is amended to exclude greeting-type
  domain events, which are retained and replayed as an ordered stream by
  `invoicebot-greeting-stream`. All other domain events keep latest-per-key
  convergence.

## Impact

- `packages/server/src/ib-domain-event-cache.ts` — greeting-type frames routed to
  an ordered per-session log instead of (or in addition to, deduped) the
  latest-per-key map; bounded to protect memory.
- `packages/server/src/pairing/browser-gateway.ts` (connect replay,
  `ibDomainEventCache.getAll()` at the replay site) — replay the ordered greeting
  stream marked `replay: true` alongside the existing per-key convergence frames.
- `packages/server/src/server.ts` (the `ibDomainEventCache.set(...)` intake and
  `clearForSession` on session death) — greeting-stream intake/cleanup.
- `packages/shared/src/browser-protocol.ts` — additive ordering field on the
  replayed greeting frame if required for chronological folding.
- `packages/client/src/lib/chat/event-reducer.ts` — new handling that folds
  greeting domain-event frames into chronological chat rows (none exists today),
  plus an additive optional `state` field on `ChatMessage` carried through the fold.
- `packages/client/src/components/chat/ChatView.tsx` — a greeting-specific
  branch/wrapper (around the assistant-row render path) that emits
  `data-greeting-marker="<state>"`; the shared `MessageBubble` is NOT modified.
- `packages/client/src/components/preview/MarkdownContent.tsx` — no code change; a
  new test pins its raw-HTML-pass-through / no-sanitizer configuration.
- No new runtime dependencies. No change to the persisted transcript format.

## Discipline Skills

- `doubt-driven-review`: the ordering/reconnect-replay contract is the crux — the
  stream must interleave correctly with assistant/user rows and survive reconnect
  without dupes; stress-test the ordering key and idempotency before it stands.
- `review-code`: non-trivial change spanning server retention, protocol, and the
  chat reducer.
- `performance-optimization`: the greeting replay runs on the hot connect path and
  the retention lives in memory — keep the ordered log bounded and the replay O(n)
  in the session's greetings only.
