## 0. Gate — settle design.md open questions

- [x] 0.1 Pick Option A (status row) or Option B (inline badge). See design.md Decision 1. → **Option B (inline badge)** chosen.
- [x] 0.2 Confirm source filter (recommend `source === "interactive"` only). See Decision 2. → confirmed interactive-only.
- [x] 0.3 Confirm `bump-pi-compat-to-0-78` has merged (this change's value depends on pi ≥ 0.77 in the wild). → archived `2026-05-30-bump-pi-compat-to-0-78`; pi pinned `^0.78.0`, installed 0.78.0.

> Implemented as **Option B (inline badge)** via the correlation approach
> described in proposal.md: an interactive mid-stream `input` event stores its
> `streamingBehavior` in `SessionState.pendingInputBehavior`; the next user
> `message_start` consumes it and stamps `ChatMessage.streamingBehavior`; the
> ChatView renders an inline badge on the user bubble.

## 1. Phase 1 — Reducer correlation (Option B)

- [x] 1.1 Add `streamingBehavior?: "steer" | "followUp"` to `ChatMessage` and `pendingInputBehavior?: "steer" | "followUp"` to `SessionState` in `packages/client/src/lib/event-reducer.ts`.
- [x] 1.2 Add `case "input"`: when `data.source === "interactive"` AND `data.streamingBehavior` is `"steer"`/`"followUp"`, set `next.pendingInputBehavior`. Idle + non-interactive sources → no-op. `input` becomes a known event (no rawEvent fallback — Decision 4).
- [x] 1.3 In the `message_start { role: "user" }` branch, stamp `streamingBehavior` from `state.pendingInputBehavior` onto the new user `ChatMessage`, then clear the slot.
- [x] 1.4 Tests in `event-reducer.test.ts`: steer, followUp, idle (no stamp), source=rpc (no stamp), source=extension (no stamp), no rawEvent card for `input`, correlation slot cleared after consumption.

## 2. Phase 2 — UI badge (Option B)

- [x] 2.1 Add `StreamingBehaviorBadge` in `ChatView.tsx`; render it above the user bubble (plain + skill-card paths) when `msg.streamingBehavior` is set. Style: small muted pill ("steered" / "queued") with `title` tooltip.
- [x] 2.2 Render test `ChatView.streaming-behavior-badge.test.tsx`: steer→"steered", followUp→"queued", idle→no badge.

## 3. Phase 3 — Verification

- [x] 3.1 Unit: `event-reducer` suite passes (158 tests).
- [x] 3.2 Client production build TS-clean (`npm run build`). Full suite: only pre-existing unrelated failures (`pi-image-fit` jimp, server `doctor-route`/`session-kill-e2e` flakes) — verified identical on baseline.
- [ ] 3.3 Manual smoke on a real session: type a message while pi is mid-tool-call; verify the badge appears with the correct label. Repeat with idle input (no badge).

## 4. Documentation

- [x] 4.1 No `AGENTS.md` change (not architectural backbone).
- [x] 4.2 No `docs/file-index-client.md` row addition; existing `event-reducer.ts` / `ChatView.tsx` rows cover responsibilities.
- [x] 4.3 CHANGELOG entry under `## [Unreleased] / ### Added`.
