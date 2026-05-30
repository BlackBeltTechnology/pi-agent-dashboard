## 0. Gate — settle design.md open questions

- [ ] 0.1 Pick Option A (status row) or Option B (inline badge). See design.md Decision 1.
- [ ] 0.2 Confirm source filter (recommend `source === "interactive"` only). See Decision 2.
- [ ] 0.3 Confirm `bump-pi-compat-to-0-78` has merged to `develop` (this change's value depends on pi ≥ 0.77 in the wild).

> Tasks below are sketched for **Option A (status row)**. If Option B is
> chosen, replace Phase 1 / Phase 2 with the correlation-based variants
> described in proposal.md.

## 1. Phase 1 — Reducer handler (Option A draft)

- [ ] 1.1 Add `eventType === "input"` case in `packages/client/src/lib/event-reducer.ts`.
- [ ] 1.2 When `data.source === "interactive"` AND `data.streamingBehavior` is `"steer"` → append a typed status message ("steering current turn") to `messages`.
- [ ] 1.3 When `data.source === "interactive"` AND `data.streamingBehavior` is `"followUp"` → append a typed status message ("queued — will deliver after current turn") to `messages`.
- [ ] 1.4 All other `input` events (idle, non-interactive sources) → no-op.
- [ ] 1.5 Tests in `event-reducer.test.ts` covering: steer, followUp, idle (no-op), source=rpc (no-op), source=extension (no-op).

## 2. Phase 2 — UI affordance

- [ ] 2.1 Add rendering for the new typed status row in the chat-view component family. Style: small muted text, distinct from regular messages.
- [ ] 2.2 Visual smoke: confirm the row is unobtrusive in tight transcripts and readable in wide views.

## 3. Phase 3 — Verification

- [ ] 3.1 Unit: `npm test -- event-reducer` passes.
- [ ] 3.2 Full suite green: `npm test`.
- [ ] 3.3 Manual smoke on a real session: type a message while pi is mid-tool-call; verify the status row appears with the correct label. Repeat with idle input (no row should appear).

## 4. Documentation

- [ ] 4.1 No `AGENTS.md` change (not architectural backbone).
- [ ] 4.2 No `docs/file-index-client.md` row addition; existing `event-reducer.ts` row's purpose covers reducer responsibilities.
- [ ] 4.3 CHANGELOG entry under `## [Unreleased] / ### Added`: "Dashboard transcript now shows when a user message will steer or queue behind a streaming turn (pi 0.77+ `InputEvent.streamingBehavior`)."
