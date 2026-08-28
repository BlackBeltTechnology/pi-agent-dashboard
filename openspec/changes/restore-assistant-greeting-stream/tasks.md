## 1. Server: ordered greeting retention

- [x] 1.1 In `packages/server/src/ib-domain-event-cache.ts`, add a bounded,
      per-session, insertion-ordered greeting stream (separate from the
      latest-per-key map), with `appendGreeting`, `getGreetingsForConnect` (ordered),
      and per-session eviction (oldest-first) on overflow.
- [x] 1.2 Extend `clearForSession` to also clear the session's retained greeting
      stream; keep the latest-per-key clear behavior unchanged.
- [x] 1.3 Ensure each retained greeting carries a stable id and a monotonic
      per-session ordering key (derive/attach if the incoming frame lacks one).

## 2. Server: intake + connect replay routing

- [x] 2.1 In `packages/server/src/server.ts` at the `ibDomainEventCache.set(...)`
      intake, classify greeting-type frames into the ordered greeting stream and
      exempt them from the latest-per-key map (non-greeting frames unchanged).
- [x] 2.2 In `packages/server/src/pairing/browser-gateway.ts` at the connect-replay
      site (currently `for (const frame of ibDomainEventCache.getAll())`), also
      replay the ordered greeting stream in emission order, each frame marked
      `replay: true`; live greeting frames remain unmarked.

## 3. Shared protocol

- [x] 3.1 In `packages/shared/src/browser-protocol.ts`, add the additive ordering
      key / stable id field on the greeting frame (and `replay?: true`) needed for
      chronological folding; keep the base `ib_domain_event` frame shape unchanged.

## 4. Client: fold greetings into chat rows + marker contract

- [x] 4.1 In `packages/client/src/lib/chat/event-reducer.ts`, add handling that
      folds greeting `ib_domain_event` frames (live and replayed) into one
      assistant-side chat row per greeting id, positioned by the ordering key,
      mirroring the existing idempotent-by-id custom-message render row.
- [x] 4.2 Add an additive optional `state` field to `ChatMessage`
      (`event-reducer.ts:33`) and carry the greeting's structured `state` onto the
      folded message; preserve it across idempotent re-fold. Do NOT scrape it from
      content.
- [x] 4.3 In `packages/client/src/components/chat/ChatView.tsx`, add a
      greeting-specific branch/wrapper around the assistant-row render path
      (~`:1276`) that emits `data-greeting-marker="<state>"` from the structured
      field. Do NOT modify the shared `MessageBubble` (`:251`); non-greeting rows
      MUST stay byte-identical (attribute absent).
- [x] 4.4 Confirm a producer-authored raw inline `<svg><path/></svg>` glyph in
      greeting content renders as real DOM through the existing `MarkdownContent`
      path (no code change expected).
- [x] 4.5 Ensure greetings render only from the domain-event frame; confirm the
      `display:false` transcript copy still produces no row (reducer + replay path).

## 4b. Close the bus→wire seam (greeting never left the producer)

- [x] 4b.1 In `packages/invoicebot-plugin/src/shared/ib-events.ts`, declare the
      greeting RENDER channel `IB_GREETING_CHANNEL = "ib:greeting"` SEPARATELY from
      the lifecycle `IB_CHANNELS` (a render event is not a lifecycle event), and
      export `IB_SUBSCRIBED_CHANNELS = [...IB_CHANNELS, IB_GREETING_CHANNEL]`. Do
      NOT add greeting to `IB_CHANNELS` (would corrupt the lifecycle set + force
      weakening `ib-events.test.ts` — forbidden). Chosen: option (b), separate
      declaration.
- [x] 4b.2 In `packages/invoicebot-plugin/src/bridge/index.ts`, subscribe over
      `IB_SUBSCRIBED_CHANNELS` so `ib:greeting` forwards via the identical envelope
      + mechanical rename (`ib:greeting` → `ib_greeting`, matching
      `IB_GREETING_EVENT_TYPE`). Boot-window buffering applies unchanged.
- [x] 4b.3 KEYING: the producer greeting payload is `{ customType, state, content,
      details }` with NO id/invoice_id (design D3: layers key off `state`). In
      `ib-domain-event-cache.ts`, derive the greeting's stable id from `state`
      (then `details.state`/`details.scope`, then legacy id/identity, then
      positional).
- [x] 4b.4 LIVE keying gap: `set()`/`appendGreeting` return the retained greeting;
      in `server.ts` stamp `greetingId`/`greetingOrder` onto the LIVE broadcast
      frame too (not only replay) so a live greeting reaches the client with a
      stable identity and dedupes against its later replay. Client
      (`useMessageHandler.ts`) resolves id = `greetingId` ?? producer `state` ??
      legacy id/identity.
- [x] 4b.5 Spec: add a MODIFIED requirement to `invoicebot-event-bridge`
      declaring the greeting render channel separately (lifecycle set + its test
      preserved), and specify in `invoicebot-greeting-stream` that the LIVE frame
      carries the server-assigned id/order.

## 5. Tests

- [x] 5.1 Server unit test: three greetings for one session replay in order on
      connect (not collapsed to newest), marked `replay: true`; session death
      clears them; per-session cap evicts oldest-first.
- [x] 5.2 Server test: a non-greeting domain event still uses latest-per-key
      convergence (unchanged).
- [x] 5.3 Reducer test: greeting frames fold into chat rows in chronological order
      relative to assistant/user rows; idempotent across live+replay by id; no
      double-render with the `display:false` transcript copy.
- [x] 5.4 Fail-loud unit test: the folded greeting message carries the structured
      `state`, AND the rendered greeting row exposes `data-greeting-marker="<state>"`
      (presence/count asserted before any ordering), while a non-greeting row does
      not — so a producer/consumer mismatch fails at unit level.
- [x] 5.5 Pin the raw-HTML contract: a test asserting `MarkdownContent` renders a
      raw inline `<svg><path/></svg>` from content as real DOM (raw-HTML
      pass-through, no HTML sanitizer), so adding a sanitizer later fails loudly.
- [x] 5.6 Run the gate: `HOME=$(mktemp -d) pnpm exec vitest run <touched test files>`
      and `npm run build`; both green.
- [x] 5.7 Bridge test (`ib-events.test.ts` + `ib-bridge-entry.test.ts`): the
      greeting channel is declared separately (IB_CHANNELS unchanged, still
      exactly 16), and a foreign-facade `ib:greeting` emission forwards as
      `ib_greeting` payload-verbatim (live + boot-buffered). `ib-events.test.ts`
      lifecycle assertion NOT weakened.
- [x] 5.8 Cache test: greeting id derives from `state`; same-state re-delivery is
      one entry; `set()` returns the retained greeting (id+order) for live stamping.
- [x] 5.9 Client seam test (`useMessageHandler.greeting-fold.test.tsx`): a LIVE
      greeting folds via `greetingId`, AND via producer `state` when `greetingId`
      is absent; live+replay dedupe; non-greeting frame yields no row; a greeting
      folded before `event_replay` survives the reset.
