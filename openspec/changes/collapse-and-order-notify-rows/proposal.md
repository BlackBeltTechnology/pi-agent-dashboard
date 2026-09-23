## Why

A failing extension that notifies on every turn floods the chat with identical cards. Observed: pi-blackhole emitted `Observational memory: observer failed: Observer: all model candidates exhausted` ~10× during a network outage; after a dashboard restart all ten rendered as ten stacked warning cards **at the bottom of the transcript, stamped "now"** — below turns that happened after them — so a recovered, 70-minute-old failure read as a fresh one.

Two defects compound:

1. **No repeat collapse.** `addNotify` dedups by `notifyId` only (correct: distinct events stay distinct), and the renderer shows each row separately, so N identical adjacent warnings cost N cards of vertical space.
2. **Replay loses chronology.** `NotifyLogEntry` is `{notifyId, message, level}` — no time. On subscribe the server replays the log after the event batches; the client appends every replayed row to the END of `messages` with `timestamp: Date.now()`. The existing spec already promises the row "SHALL appear as it did before the refresh" — replay breaks that promise for position and time.

## What Changes

- **Notify carries an emit time.** The bridge stamps `ts` (epoch ms, `Date.now()`) on the pi→server `notify` message — the same clock that stamps every transcript event, so ordering holds for remote bridges too. The server keeps a valid bridge `ts` (finite, > 0) and otherwise stamps its own receipt time (older bridges, legacy `prompt_request`, garbage values). `NotifyLogEntry` and the server→browser `notify` message gain the optional `ts`; it is persisted with the notify log, so it survives a server restart.
- **Client places a timed notify chronologically.** `addNotify` accepts optional `ts`: the row's `timestamp` becomes `ts`, and the row is inserted after the last transcript row whose `timestamp <= ts` instead of at the tail. Without `ts` (entries persisted before this change, older servers) behaviour is unchanged: append with `Date.now()`. Both client reducers (main-app handler, embed session-state) share `addNotify`.
- **Adjacent identical notifies render as one row with a count.** A pure render-time pass collapses a run of consecutive *visible* notify rows with the same level and identical message text into one row showing `×N` and the first–last time. State is untouched: every `notifyId` stays its own `messages` row, dedup stays by `notifyId`, replay stays idempotent. A differing row (other message, other level, any non-notify visible row) breaks the run.
- No change to the notify log cap (50), level gating (`notifyMinLevel`), or the "notify is never a pending ask" invariants.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `notify-message-channel`: the `notify` message and log entry gain an optional server-stamped `ts`; a replayed notify keeps its transcript position and time; adjacent identical notify rows render collapsed with a repeat count (rows stay distinct in state — "two identical notifications both render" is refined to "both are retained and counted").
- `chat-view`: the `displayRows` derivation gains the collapse step inside the same memo, so every index-keyed consumer reads one collapsed array.

## Impact

- `packages/shared/src/types.ts` — `NotifyLogEntry.ts?: number`.
- `packages/shared/src/browser-protocol.ts` — `BrowserNotifyMessage.ts?: number`; `packages/shared/src/protocol.ts` — `NotifyMessage.ts?: number`.
- `packages/extension/src/` notify send site — stamps `ts`.
- `packages/server/src/event-wiring.ts` (`handleNotify`), `packages/server/src/pairing/notify-log.ts` (`fromLegacyPromptRequest`), `packages/server/src/pairing/browser-gateway.ts` (`replayNotifyLog` forwards `ts`).
- `packages/client/src/lib/chat/event-reducer.ts` — pure `insertByTs` + `addNotify(..., ts?)` chronological insert.
- `packages/client/src/hooks/useMessageHandler.ts` history-backfill splice — re-seats ts-placed notify rows after each segment.
- `packages/client/src/hooks/useMessageHandler.ts`, `packages/client/src/hooks/useSessionState.ts` — pass `msg.ts`.
- New `packages/client/src/lib/chat/collapse-repeated-notifies.ts` (pure) + wiring in `packages/client/src/components/chat/ChatView.tsx`; `NotifyRenderer.tsx` renders the count / time range and shares its rendered-text helper (`message` → `title` fallback) with the collapse key; i18n keys hand-added to the `zhCN` literal in `i18n.tsx` and to `huCatalog` in `i18n-hu.ts` (the `en` catalog is empty by design; English is the call-site fallback).
- **Compatibility:** additive optional fields. New client + old server → no `ts` → today's behaviour. Old client + new server → ignores `ts`. Old bridge + new server → server receipt time. New bridge + old server → old server drops `ts` → today's behaviour. Persisted `.meta.json` notify logs without `ts` load unchanged.
- **Rollback:** revert; persisted `ts` fields are ignored by the old reader (extra JSON key).
- No migration.

## Discipline Skills

- `review-code` — non-trivial client + server change before commit.
- Not triggered: `security-hardening` (the bridge is already the trusted source of every transcript timestamp; the server only accepts a finite positive number and falls back to its own clock, and `ts` only affects row order within one session's own transcript), `performance-optimization` (the collapse is one extra linear pass inside the existing `displayRows` memo, which already re-runs per streaming chunk and already does a linear filter; the insert scans back from the tail and is dominated by the existing linear dedup check), `observability-instrumentation` (no new endpoint/job), `doubt-driven-review` beyond the planning review (no irreversible step — additive optional fields).
