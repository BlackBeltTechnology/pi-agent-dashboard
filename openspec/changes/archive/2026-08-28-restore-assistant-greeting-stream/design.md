## Context

Invoice assistant greetings reach the browser as app-level `ib_domain_event`
frames. The server's reconnect retention (`packages/server/src/ib-domain-event-cache.ts`)
is a latest-per-key map — keyed `${eventType}\u0000${entityId}` — documented as
"the latest event per key — never a historical log". All greetings for one invoice
collapse to that key. A measured run (three greetings across
`partner_pending → pending_approval → exported`) replays exactly one frame,
`["exported"]`, on connect. Greetings are also written to the transcript as
`display:false` custom messages purely for model context; both the live reducer
(`packages/client/src/lib/chat/event-reducer.ts`, the `role === "custom" && display`
gate) and the replay path (`packages/shared/src/state-replay.ts`, the
`entry.type === "custom_message" && entry.display` gate) correctly refuse to render
`display:false` entries. The client has no handling of `ib_domain_event` frames at
all today, so no chat-row rendering path for greetings exists.

The result: a client that mounts or reconnects after greetings were emitted sees at
most the newest greeting, never the chronological stream.

A marker-contract spike (executed against this repo's real `MarkdownContent`)
settled how a greeting row exposes its state and its glyph:
- The fold at `event-reducer.ts:1730-1768` DROPS `customType` and any `state`
  field, keeping only joined text — so no structured state reaches the row today.
- HTML comments are dropped entirely by the renderer (`<!-- ib-state:x -->` yields
  no DOM node and no text), so a comment marker is unusable.
- Raw inline HTML/SVG in content DOES render as real DOM: the renderer uses
  `react-markdown` with `rehypeRaw` and NO `rehype-sanitize` (`MarkdownContent.tsx:485`),
  and `stripReactRefAttributes` deletes only `ref` (`:119`). So a producer-authored
  `<svg><path/></svg>` glyph renders, and content-embedded `data-*` survives — but
  the state marker is specced as a structured-field row attribute, not scraped.

## Goals / Non-Goals

**Goals:**
- Retain the per-session greeting stream in chronological order and replay it in
  full on connect, marked `replay: true`.
- Fold greeting frames (live and replayed) into chat rows in correct chronological
  order relative to assistant/user rows, idempotent by a stable greeting id.
- Carry the greeting's structured `state` onto the folded chat message (additive
  optional field) and expose it as a row-level `data-greeting-marker="<state>"`.
- Render a producer-authored raw-inline-HTML glyph in greeting content, and pin the
  raw-HTML-pass-through / no-sanitizer renderer contract with a test.
- Leave the `display:false` transcript copy non-rendering; render greetings once,
  from the domain-event frame.
- Leave non-greeting domain events on the unchanged latest-per-key convergence
  path.

**Non-Goals:**
- Changing how or when the producer emits greetings. The producer is treated as a
  generic emitter of greeting-type domain events; this change only defines
  retention, replay, and rendering.
- Changing the persisted transcript format or the wire frame shape.
- Replaying a historical log for non-greeting domain events.

## Decisions

- **Separate ordered greeting stream, not a general history log.** Add a bounded,
  per-session, insertion-ordered structure for greeting-type frames alongside the
  existing latest-per-key map, rather than converting the whole cache to a log.
  This keeps latest-per-key convergence (and its tests) intact for card-state and
  other domain events, and confines history semantics to greetings.
- **Route by event type.** The retention intake (`ibDomainEventCache.set` call site
  in `server.ts`) classifies greeting-type frames into the ordered stream; all
  other frames keep the latest-per-key path. Greetings are exempted from
  latest-per-key so they are not additionally replayed as a collapsed frame.
- **Ordering + identity.** Each greeting frame carries a stable id and an ordering
  key (a monotonic per-session sequence or the greeting's emission timestamp),
  surfaced on the replayed frame if not already present, so the reducer positions
  rows chronologically and dedupes across live/replay by id.
- **Client folding in the chat reducer.** `event-reducer.ts` gains a greeting
  branch that builds one assistant-side chat row per greeting id, positioned by the
  ordering key, mirroring the existing idempotent-by-id custom-message render row.
  The fold carries the structured `state` onto the chat message as an additive
  optional field — `ChatMessage` already has ~15 optional fields, so this is
  idiomatic and non-breaking; the state is read from structure, never scraped from
  content.
- **Marker = structured-field row attribute, lowest blast radius.** The row exposes
  `data-greeting-marker="<state>"` from the structured field via a greeting-specific
  branch/wrapper around the assistant-row render path in `ChatView.tsx` (near the
  assistant branch at ~`:1276`). The shared `MessageBubble` (`ChatView.tsx:251`),
  used by EVERY assistant row in EVERY pi session, is NOT modified; the attribute is
  conditionally present only for greetings, so all other rows are byte-identical.
  Comments are rejected (renderer drops them); content-scraping is rejected
  (sanitization risk, coupling to markdown).
- **Glyph = producer-authored raw inline HTML, contract pinned.** The per-state MDI
  glyph arrives from the producer inside greeting content as raw inline
  `<svg><path/></svg>`; this repo just renders it via the existing `rehypeRaw` path.
  This is a deliberate design property: **server-authored greeting content is
  rendered as raw HTML** (no HTML sanitizer sits in the pipeline). A pinning test
  asserts the raw-HTML-pass-through / no-`rehype-sanitize` configuration so a later
  sanitizer addition fails loudly instead of silently stripping every glyph.
- **Bounded memory + lifecycle.** The greeting stream is capped per session
  (oldest-dropped-first on overflow) and cleared on session death via the existing
  `clearForSession` hook.

## Risks / Trade-offs

- **Double delivery / double render.** A greeting could arrive as both a replay and
  a live frame, or coexist with its `display:false` transcript copy. Mitigation:
  idempotent folding keyed by the greeting's stable id, and rendering greetings
  only from the domain-event frame (never the transcript copy).
- **Ordering fidelity across channels.** Greeting rows must interleave correctly
  with assistant/user rows that are ordered by the chat event stream. Mitigation:
  a monotonic ordering key on the greeting frame; verify interleaving in tests.
- **Hot connect path cost.** Replay runs on every browser connect. Mitigation: the
  greeting stream is bounded per session and replay is O(n) in that session's
  greetings only.
- **Unbounded sessions.** A very long-lived session could accrue many greetings.
  Mitigation: per-session cap with oldest-first eviction; the cap is sized so a
  normal invoice lifecycle's greetings are never evicted.
- **Shared-render blast radius (honest).** The marker is emitted from a
  greeting-specific branch/wrapper in `ChatView.tsx`, NOT from the shared
  `MessageBubble`. Blast radius is therefore confined to greeting rows: non-greeting
  assistant/user rows keep byte-identical output, and the bubble renderer shared
  across all pi sessions is untouched. If the attribute were placed inside
  `MessageBubble` instead, the edit site would be hotter (shared by every assistant
  row); that placement is explicitly rejected here.
- **Rendering server-authored raw HTML.** Rendering producer content as raw HTML is
  a real, deliberate property — not an oversight. It is scoped to greeting content
  from the trusted producer; the pinning test makes any future move to sanitize this
  path a loud, intentional decision rather than a silent glyph-stripping regression.
- **Fail-loud on producer/consumer mismatch.** Unit coverage asserts the folded
  greeting message carries `state` AND the rendered row exposes
  `data-greeting-marker`, so a mismatch fails at unit level; any e2e MUST assert
  presence/count of `[data-greeting-marker]` before ordering, so a missing marker
  fails "expected N, got 0" rather than an empty locator silently passing.
