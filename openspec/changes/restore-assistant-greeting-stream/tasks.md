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
